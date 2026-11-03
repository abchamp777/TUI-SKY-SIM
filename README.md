# SKYSIM | TUI Airways PTFS Flight Operations

Independent Roblox PTFS community project. Not affiliated with TUI Airways, Roblox, or PTFS.

The ZIP includes your two supplied images:
- `client/public/assets/license-reference.png`: your example staff ID/license appearance reference (`PILOT-0002`).
- `client/public/assets/ptfs-map.png`: your supplied PTFS airport chart.

## Included in this starter build

- React + Vite responsive operations interface.
- Express backend, PostgreSQL persistence through Prisma.
- Server-managed HttpOnly sessions and role checks on protected APIs.
- Roblox username lookup and profile-description ownership challenge.
- Pilot-license application upload (PNG/JPG/JPEG/WEBP, maximum 5 MB).
- Staff review queue with private image viewing and approve/reject actions.
- Flight plan creation and personal flight list.
- Groq-powered virtual PTFS AI ATC endpoint.
- Controller-published ATIS.
- Supplied PTFS map image.
- Prisma data models for users, applications, airports, runways, aircraft, flights, ATIS, ATC messages, and audit logs.

## Important honest limitations

This is a working starter application, not a finished airline-grade production deployment. The supplied license image is a **visual reference only**, not a valid license template or evidence of approval. Staff must manually inspect all license submissions. Roblox public username lookup does not prove account ownership; this project uses a one-time code in the public Roblox profile description as an ownership challenge. It does not ask for or store Roblox passwords.

Airport coordinates and runway information are not invented. The map currently displays your supplied image; calibrated airport markers, route overlays, PDF export, live aircraft tracking, live voice radio, full airport/aircraft admin editors, and object-storage integration still need implementation/configuration. Live tracking is not faked. AI ATC is disabled until a Groq API key is configured.

## Windows installation

Requirements: Node.js 22 LTS, PostgreSQL 15+, and VS Code.

1. Extract the ZIP and open the `SKYSIM-TUI-PTFS` folder in VS Code.
2. Open Terminal > New Terminal.
3. Install dependencies:

   ```powershell
   npm install
   ```

4. Copy `.env.example` to `.env`.
5. Create a PostgreSQL database named `skysim`.
6. Set `DATABASE_URL` in `.env` to your PostgreSQL connection string.
7. Set `SESSION_SECRET` to a random string of at least 32 characters.
8. Generate Prisma and create database tables:

   ```powershell
   npm run db:generate
   npm run db:migrate
   ```

9. Start the app:

   ```powershell
   npm run dev
   ```

10. Open `http://localhost:5173`. The API runs on port 4000.

## Environment variables

See `.env.example`. Keep `.env` private and never commit it to GitHub. `GROQ_API_KEY` is used only by the backend. Set `GROQ_MODEL` if you want a different compatible model.

## First administrator

This starter does not provide a public admin-creation route. Create the first admin directly in PostgreSQL after registering a Roblox user and reviewing the account, or add a one-time protected bootstrap script before deployment. Do not expose an unrestricted role-change endpoint.

## Render deployment outline

1. Push this folder to a private GitHub repository.
2. Create a Render PostgreSQL database.
3. Create a Render Web Service connected to the repository.
4. Build command: `npm install && npm run db:generate && npm run build`
5. Start command: `npm run start`
6. Configure `DATABASE_URL`, `SESSION_SECRET`, `CLIENT_ORIGIN`, `NODE_ENV=production`, and `GROQ_API_KEY` in Render.
7. Run `npm run db:migrate` against the production database before launch.
8. Configure private persistent storage for license uploads. The included local disk upload directory is for development only.
9. Confirm HTTPS cookies and review security settings before inviting users.

## Security before public launch

Use HTTPS, strong secrets, private object storage, database backups, upload retention/deletion policies, and a formal privacy notice. Review CSRF protections and add a robust CSRF token flow before production. Configure an officially supported Roblox OAuth flow if one is available to your application. The included profile-description challenge is a fallback, not OAuth.
