# Find a Service Provider

A service marketplace for Lesotho. Customers find providers, chat privately, send requests and track them.
Providers manage their profile, services, chats and requests. Administrators and a separate security administrator manage the platform.

Stack: React (Vite), Node.js and Express, PostgreSQL, Socket.IO for live chat.

## Folder map

- database/schema.sql           The full PostgreSQL schema plus reference data (roles, permissions, districts, categories, policies)
- server/                       The API (Express)
  - src/routes/                 auth, customer (OTP), catalog, requests, messages, provider, notifications, admin, security
  - src/middleware/auth.js      Login checks and the read/write permission check
  - src/utils/                  encryption, ledger (blockchain preparation), SMS, retention rules, uploads
  - src/jobs/retention.js       Nightly cleanup of expired chats and report snapshots
  - src/scripts/                migrate.js and seed.js
  - test/smoke.js               86 automatic checks of the main rules
- client/                       The website (React)
  - index.html and src/main.jsx           The public app: customers, providers, administrators
  - security.html and src/security-main.jsx   The separate security portal

## Design

The website is fully responsive. On phones it uses a bottom tab bar, on laptops and desktops a top menu (public site) or a side menu (provider, admin and security areas). Messages show the conversation list and the chat side by side on large screens.
To show your own photo on the landing page, save it as client/public/hero.jpg.

## Run it on your computer (VS Code)

You need Node.js 18 or newer and PostgreSQL.

Step 1. Create the database
- Open pgAdmin or psql and create an empty database called find_a_service_provider.

Step 2. Set up the server
- Open a terminal in the server folder.
- Copy .env.example to .env and fill in DATABASE_URL, JWT_SECRET and MESSAGE_ENC_KEY (the file shows how to generate them).
- Run: npm install
- Run: npm run migrate     (creates all tables and reference data)
- Run: npm run seed        (adds demo accounts, providers, requests and one chat)
- Run: npm run dev         (the API starts on port 4000)

Step 3. Set up the website
- Open a second terminal in the client folder.
- Run: npm install
- Run: npm run dev         (the website starts on port 5173)

Step 4. Open it
- Public app:      http://localhost:5173
- Security portal: http://127.0.0.1:5173/security.html   (a different address on purpose, so it has its own login storage)

## Demo accounts (created by npm run seed)

- Administrator:   admin@fsp.test / Admin@12345            (log in at /login)
- Security admin:  security@fsp.test / Secure@12345        (security portal only)
- Providers:       provider1@fsp.test to provider11@fsp.test / Provider@123
- Customers:       no account. Choose any phone number, for example +26658000001, and enter the code shown on the screen.

The one-time code is shown on screen because OTP_MODE=mock. For a real launch, connect an SMS provider in server/src/utils/sms.js and set OTP_MODE=sms.

## Check that everything works

With the API running and the demo data loaded, run in the server folder:

    npm run smoke

It tests search, OTP, private chat, live messages, requests, reviews, reports, retention, permissions, lockout and data erasure.

## How the main rules are enforced

- Customers have no account. A phone number is verified with a one-time code and the customer gets a temporary login (12 hours).
- A chat can be opened only by its two members. Everyone else gets "not found", and the attempt is written to the security log.
- Message text is encrypted in the database (AES-256-GCM). Photos are stored in a private folder and served only after an access check.
- Admins never read live chats. When someone reports a chat, a snapshot of the reported messages plus 3 messages either side is saved. Admins read only that snapshot, and every time they open it, it is logged.
- Retention: chats with no request are deleted 90 days after the last message. Chats linked to a request are kept for 365 days after the request closes. Report snapshots are kept 30 days after resolution. A chat with an open report is never deleted. The values can be changed in the security portal.
- Customers can delete a chat, or all their data, at any time (unless a report is still open).
- The read/write permission matrix is stored in the database and edited in the security portal. Changes apply within seconds, even to people already logged in.
- The security portal has its own login, its own token type and its own page, so it can be hosted on a separate address.
- Accounts lock for 15 minutes after 5 wrong passwords. The security portal shows failed logins and suspicious addresses.

## Part B preparation (blockchain, phase 2)

Everything is ready for the blockchain layer, which is not added yet:

- Each service request, status change and review gets a SHA-256 fingerprint saved in record_hash and queued in the ledger_records table with status pending.
- Only fingerprints go on the blockchain. Names, phone numbers and messages never do.
- GET /api/verify/request/:reference recomputes the fingerprint and tells you if the record was changed.
- To finish phase 2, implement submitPending() in server/src/utils/ledger.js: send each pending hash to a smart contract, then save tx_hash and set the row to anchored. Call it after each write or from a small scheduled job, and set BLOCKCHAIN_ENABLED=true.

## Hosting (when you are ready)

Option 1, one server (simplest):
- Run: cd client && npm run build
- Start the server with NODE_ENV=production. It serves the website from client/dist and the API from the same address.
- Set DATABASE_URL, JWT_SECRET and MESSAGE_ENC_KEY as environment variables on the host. In production the server refuses to start without them.
- The host needs a persistent disk for server/uploads (photos), or move uploads to cloud storage later.
- Keep the same MESSAGE_ENC_KEY forever. If it changes, old messages cannot be read.

Option 2, security portal on its own address:
- Build the client with VITE_API_URL set to your API address, and publish only security.html and its assets on a separate address such as security.yoursite.com.
- Set CLIENT_ORIGIN and SECURITY_ORIGIN on the server to the two website addresses.

## Part C and D notes

- Part C2 (read and write permissions per actor per module, plus a security configuration module in a different domain) is implemented: see the permissions matrix in the security portal and the role_permissions table.
- Parts C1 and C3 (data classification and GDPR) are spreadsheets. The tables in database/schema.sql are the list of data the application handles.
- Part D: the seed creates about 60 requests and reviews over 120 days. Add more through normal use or a larger seed to build your dataset.
