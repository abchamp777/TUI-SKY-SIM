import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import {fileTypeFromBuffer} from 'file-type';
import {PrismaClient} from '@prisma/client';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';

const dir=path.dirname(fileURLToPath(import.meta.url)),app=express(),db=new PrismaClient();
const port=Number(process.env.PORT||4000),prod=process.env.NODE_ENV==='production';
if(!process.env.DATABASE_URL)console.warn('DATABASE_URL is missing. Configure PostgreSQL before starting.');
if(!process.env.SESSION_SECRET||process.env.SESSION_SECRET.length<32)console.warn('Set a long random SESSION_SECRET before deployment.');
app.set('trust proxy',1);app.use(helmet());app.use(cors({origin:process.env.CLIENT_ORIGIN||'http://localhost:5173',credentials:true}));app.use(express.json({limit:'200kb'}));
const PgStore=connectPgSimple(session);
app.use(session({store:new PgStore({conString:process.env.DATABASE_URL,tableName:'user_sessions',createTableIfMissing:true}),secret:process.env.SESSION_SECRET||'dev-only-change-this-secret-please-123456',resave:false,saveUninitialized:false,cookie:{httpOnly:true,secure:prod,sameSite:'lax',maxAge:8*60*60*1000}}));
app.use('/api',rateLimit({windowMs:15*60*1000,limit:150}));
const uploads=path.resolve(dir,'../private-uploads');await mkdir(uploads,{recursive:true});
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024},fileFilter:(q,f,cb)=>cb(null,['image/png','image/jpeg','image/webp'].includes(f.mimetype))});
const fail=(res,n,error)=>res.status(n).json({error});
const auth=(q,s,n)=>q.session.user?n():fail(s,401,'Sign in required.');
const active=(q,s,n)=>q.session.user?.active?n():fail(s,403,'An approved active account is required.');
const roles=(...r)=>(q,s,n)=>!q.session.user?fail(s,401,'Sign in required.'):r.includes(q.session.user.role)?n():fail(s,403,'Insufficient permissions.');
const safe=u=>({id:u.id,robloxUsername:u.robloxUsername,role:u.role,active:u.active,licenseNumber:u.licenseNumber});
async function robloxUser(username){const r=await fetch('https://users.roblox.com/v1/usernames/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({usernames:[username],excludeBannedUsers:false})});if(!r.ok)throw Error('Roblox user lookup unavailable.');return (await r.json()).data?.[0]||null}
const pendingChallenges=new Map();
app.get('/api/health',async(q,s)=>{try{await db.$queryRaw`SELECT 1`;s.json({status:'ok',database:'connected',groqConfigured:!!process.env.GROQ_API_KEY})}catch{s.status(503).json({status:'degraded',database:'unavailable'})}});
app.get('/api/auth/me',auth,(q,s)=>s.json({user:q.session.user}));
app.post('/api/auth/logout',auth,(q,s)=>q.session.destroy(()=>s.json({ok:true})));
app.post('/api/applications',upload.single('licenseImage'),async(q,s)=>{
 try{const v=z.object({robloxUsername:z.string().min(3).max(20),pilotName:z.string().min(1).max(80),licenseNumber:z.string().min(3).max(40)}).parse(q.body);if(!q.file)return fail(s,400,'License image required.');const type=await fileTypeFromBuffer(q.file.buffer);if(!type||!['image/png','image/jpeg','image/webp'].includes(type.mime))return fail(s,400,'Unsupported image format.');const rb=await robloxUser(v.robloxUsername);if(!rb)return fail(s,404,'Roblox username not found.');const exists=await db.licenseApplication.findFirst({where:{robloxUserId:String(rb.id),status:'PENDING'}});if(exists)return fail(s,409,'An application is already pending.');const u=await db.user.upsert({where:{robloxUserId:String(rb.id)},update:{robloxUsername:rb.name,pilotName:v.pilotName,licenseNumber:v.licenseNumber},create:{robloxUserId:String(rb.id),robloxUsername:rb.name,pilotName:v.pilotName,licenseNumber:v.licenseNumber}});const filename=randomBytes(20).toString('hex')+'.'+type.ext,full=path.join(uploads,filename);await writeFile(full,q.file.buffer);await db.licenseApplication.create({data:{userId:u.id,robloxUsername:rb.name,robloxUserId:String(rb.id),pilotName:v.pilotName,licenseNumber:v.licenseNumber,imagePath:full}});s.status(201).json({message:'Application submitted. Staff approval is required before account activation.'})}catch(e){s.status(400).json({error:e.message})}
});
app.post('/api/auth/challenge',async(q,s)=>{
 try{const v=z.object({robloxUsername:z.string().min(3),licenseNumber:z.string().min(3)}).parse(q.body),rb=await robloxUser(v.robloxUsername);if(!rb)return fail(s,404,'Roblox username not found.');const u=await db.user.findUnique({where:{robloxUserId:String(rb.id)}});if(!u||!u.active||u.licenseNumber?.toLowerCase()!==v.licenseNumber.toLowerCase())return fail(s,403,'No approved account matches those details.');const id=randomBytes(20).toString('hex'),code='SKYSIM-'+randomBytes(3).toString('hex').toUpperCase();pendingChallenges.set(id,{userId:u.id,robloxUserId:u.robloxUserId,code,expires:Date.now()+600000});s.json({challengeId:id,code})}catch(e){s.status(400).json({error:e.message})}
});
app.post('/api/auth/verify',async(q,s)=>{
 try{const c=pendingChallenges.get(q.body.challengeId);if(!c||c.expires<Date.now())return fail(s,400,'Challenge expired. Start again.');const r=await fetch('https://users.roblox.com/v1/users/'+c.robloxUserId);if(!r.ok)return fail(s,502,'Could not read public Roblox profile.');const p=await r.json();if(!String(p.description||'').includes(c.code))return fail(s,403,'The code was not found in your public Roblox profile description.');pendingChallenges.delete(q.body.challengeId);const u=await db.user.update({where:{id:c.userId},data:{ownershipVerified:true}});if(!u.active)return fail(s,403,'Identity verified, but staff approval is still required.');q.session.regenerate(err=>{if(err)return fail(s,500,'Could not create session.');q.session.user=safe(u);q.session.save(e=>e?fail(s,500,'Could not save session.'):s.json({user:q.session.user}))})}catch(e){s.status(400).json({error:e.message})}
});
app.get('/api/flights',auth,async(q,s)=>{const where=['ADMIN','STAFF'].includes(q.session.user.role)?{}:{ownerId:q.session.user.id};s.json({flights:await db.flight.findMany({where,orderBy:{createdAt:'desc'},take:100})})});
app.post('/api/flights',auth,active,async(q,s)=>{try{const v=z.object({callsign:z.string().min(2).max(20),departure:z.string().min(2),arrival:z.string().min(2),aircraft:z.string().min(2),pilot:z.string().max(40).optional(),copilot:z.string().max(40).optional(),altitude:z.string().max(20).optional(),remarks:z.string().max(1000).optional()}).parse(q.body);if(v.departure===v.arrival)return fail(s,400,'Departure and arrival must differ.');const flight=await db.flight.create({data:{...v,ownerId:q.session.user.id}});s.status(201).json({flight})}catch(e){s.status(400).json({error:e.message})}});
app.post('/api/atc/chat',auth,active,async(q,s)=>{
 try{const v=z.object({message:z.string().min(1).max(1500),frequency:z.string(),airport:z.string(),callsign:z.string()}).parse(q.body);if(!process.env.GROQ_API_KEY)return fail(s,503,'AI ATC is not configured. Add GROQ_API_KEY on the server.');const airport=await db.airport.findUnique({where:{name:v.airport},include:{runways:true}});const facts=airport?`Configured PTFS airport: ${airport.name}. Verified runways: ${airport.runways.filter(x=>x.verified).map(x=>x.designator).join(', ')||'none'}. Notes: ${airport.notes||'none'}.`:`No airport record exists for ${v.airport}. Do not invent details.`;const response=await fetch('https://api.groq.com/openai/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.GROQ_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.GROQ_MODEL||'llama-3.3-70b-versatile',temperature:.3,max_tokens:220,messages:[{role:'system',content:`You are SKYSIM Virtual ATC for Roblox PTFS roleplay, not real aviation control. Be concise. Never claim to control aircraft. Never invent runway, weather or airport facts. Ask when details are missing. Frequency ${v.frequency}; callsign ${v.callsign}. ${facts}`},{role:'user',content:v.message}]})});const d=await response.json();if(!response.ok)throw Error(d.error?.message||'Groq request failed.');const reply=d.choices?.[0]?.message?.content||'No response generated.';await db.atcMessage.createMany({data:[{userId:q.session.user.id,role:'PILOT',content:v.message,frequency:v.frequency},{userId:q.session.user.id,role:'AI_ATC',content:reply,frequency:v.frequency}]});s.json({reply})}catch(e){s.status(502).json({error:e.message})}
});
app.get('/api/atis',auth,async(q,s)=>s.json({records:await db.atisRecord.findMany({orderBy:{updatedAt:'desc'},take:50})}));
app.post('/api/atis',auth,roles('ADMIN','ATC_CONTROLLER'),async(q,s)=>{try{const v=z.object({airport:z.string(),letter:z.string().length(1),remarks:z.string().max(1000)}).parse(q.body);s.status(201).json({record:await db.atisRecord.create({data:{...v,updatedBy:q.session.user.robloxUsername}})})}catch(e){s.status(400).json({error:e.message})}});
app.get('/api/staff/applications',auth,roles('ADMIN','STAFF'),async(q,s)=>s.json({applications:await db.licenseApplication.findMany({orderBy:{createdAt:'asc'},take:100,select:{id:true,robloxUsername:true,pilotName:true,licenseNumber:true,status:true,createdAt:true}})}));
app.get('/api/staff/applications/:id/image',auth,roles('ADMIN','STAFF'),async(q,s)=>{const a=await db.licenseApplication.findUnique({where:{id:q.params.id}});if(!a)return fail(s,404,'Not found.');s.sendFile(a.imagePath)});
app.patch('/api/staff/applications/:id',auth,roles('ADMIN','STAFF'),async(q,s)=>{try{const v=z.object({status:z.enum(['APPROVED','REJECTED','MORE_INFO']),note:z.string().max(1000).optional()}).parse(q.body);const a=await db.licenseApplication.findUnique({where:{id:q.params.id}});if(!a)return fail(s,404,'Application not found.');await db.$transaction(async tx=>{await tx.licenseApplication.update({where:{id:a.id},data:{status:v.status,reviewNote:v.note||'',reviewedBy:q.session.user.robloxUsername}});if(v.status==='APPROVED')await tx.user.update({where:{id:a.userId},data:{active:true,role:'PILOT'}});if(v.status==='REJECTED')await tx.user.update({where:{id:a.userId},data:{active:false}});await tx.auditLog.create({data:{userId:q.session.user.id,action:'LICENSE_'+v.status,details:{applicationId:a.id,username:a.robloxUsername}}})});s.json({ok:true})}catch(e){s.status(400).json({error:e.message})}});
app.use(express.static(path.resolve(dir,'../../client/dist')));app.get('*',(q,s)=>s.sendFile(path.resolve(dir,'../../client/dist/index.html')));
app.listen(port,()=>console.log('SKYSIM API listening on '+port));
