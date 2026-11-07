-- =====================================================================
-- FIND A SERVICE PROVIDER - PostgreSQL schema (safe to run more than once)
-- Run:  psql -U <user> -d <database> -f database/schema.sql
-- Or:   cd server && npm run migrate
-- =====================================================================

-- ---------- 1. ACCESS CONTROL (roles, modules, read/write matrix) ----------
CREATE TABLE IF NOT EXISTS roles (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(30) UNIQUE NOT NULL,       -- customer, provider, admin, security_admin
  description   TEXT,
  is_registered BOOLEAN NOT NULL DEFAULT TRUE      -- customers have no permanent account
);

CREATE TABLE IF NOT EXISTS modules (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(40) UNIQUE NOT NULL,
  name        VARCHAR(80) NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id    INT NOT NULL REFERENCES roles(id)   ON DELETE CASCADE,
  module_id  INT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  can_read   BOOLEAN NOT NULL DEFAULT FALSE,
  can_write  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, module_id)
);

-- ---------- 2. USERS (providers and administrators only) ----------
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(120) NOT NULL,
  email         VARCHAR(160) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role_id       INT NOT NULL REFERENCES roles(id),
  status        VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','disabled')),
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 3. CATALOGUE ----------
CREATE TABLE IF NOT EXISTS districts (
  id   SERIAL PRIMARY KEY,
  name VARCHAR(60) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(80) UNIQUE NOT NULL,
  slug        VARCHAR(80) UNIQUE NOT NULL,
  description TEXT,
  icon        VARCHAR(30),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS providers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_name VARCHAR(160) NOT NULL,
  description   TEXT,
  phone         VARCHAR(30),
  district_id   INT REFERENCES districts(id),
  profile_image TEXT,
  avg_rating    NUMERIC(3,2) NOT NULL DEFAULT 0,
  review_count  INT NOT NULL DEFAULT 0,
  availability  TEXT,
  status        VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_districts (       -- service coverage areas
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  district_id INT  NOT NULL REFERENCES districts(id) ON DELETE CASCADE,
  PRIMARY KEY (provider_id, district_id)
);

CREATE TABLE IF NOT EXISTS services (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  category_id  INT  NOT NULL REFERENCES categories(id),
  name         VARCHAR(160) NOT NULL,
  description  TEXT,
  price        NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  availability TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_services_provider ON services(provider_id);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category_id);

-- ---------- 4. TEMPORARY CUSTOMER IDENTITY (no permanent accounts) ----------
CREATE TABLE IF NOT EXISTS customer_identities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(120) NOT NULL,
  phone            VARCHAR(40) UNIQUE NOT NULL,
  verified         BOOLEAN NOT NULL DEFAULT FALSE,
  last_verified_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      VARCHAR(40) NOT NULL,
  code_hash  TEXT NOT NULL,                  -- OTP is never stored in plain text
  expires_at TIMESTAMPTZ NOT NULL,
  attempts   INT NOT NULL DEFAULT 0,
  consumed   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, created_at DESC);

-- ---------- 5. CONVERSATIONS AND SERVICE REQUESTS ----------
CREATE TABLE IF NOT EXISTS conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id     UUID NOT NULL REFERENCES customer_identities(id) ON DELETE CASCADE,
  provider_id     UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  status          VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,               -- retention date, see jobs/retention.js
  UNIQUE (customer_id, provider_id)
);

CREATE TABLE IF NOT EXISTS service_requests (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number VARCHAR(20) UNIQUE NOT NULL,
  customer_id      UUID NOT NULL REFERENCES customer_identities(id),
  provider_id      UUID NOT NULL REFERENCES providers(id),
  service_id       UUID REFERENCES services(id) ON DELETE SET NULL,
  conversation_id  UUID REFERENCES conversations(id) ON DELETE SET NULL,
  description      TEXT NOT NULL,
  location         VARCHAR(160) NOT NULL,
  preferred_date   DATE,
  preferred_time   VARCHAR(20),
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','accepted','rejected','in_progress','completed','cancelled')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ,
  record_hash      CHAR(64),                 -- blockchain: SHA-256 fingerprint of the record
  tx_hash          VARCHAR(80)               -- blockchain: transaction id once anchored
);
CREATE INDEX IF NOT EXISTS idx_req_provider ON service_requests(provider_id, status);
CREATE INDEX IF NOT EXISTS idx_req_customer ON service_requests(customer_id);

CREATE TABLE IF NOT EXISTS request_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  file_path   TEXT NOT NULL,
  file_type   VARCHAR(60),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS request_status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  old_status      VARCHAR(20),
  new_status      VARCHAR(20) NOT NULL,
  changed_by_role VARCHAR(20) NOT NULL,
  changed_by_id   UUID,
  changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  record_hash     CHAR(64),
  tx_hash         VARCHAR(80)
);

CREATE TABLE IF NOT EXISTS reviews (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID UNIQUE NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,  -- one review per request
  customer_id UUID NOT NULL REFERENCES customer_identities(id),
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  rating      INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  record_hash CHAR(64),
  tx_hash     VARCHAR(80)
);

-- ---------- 6. PRIVATE MESSAGING ----------
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_role     VARCHAR(10) NOT NULL CHECK (sender_role IN ('customer','provider')),
  sender_id       UUID NOT NULL,
  content_enc     TEXT,                      -- AES-256-GCM encrypted text (iv:tag:cipher)
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, sent_at);

CREATE TABLE IF NOT EXISTS message_attachments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,               -- private disk path, never served publicly
  original_name VARCHAR(200),
  file_type     VARCHAR(60),
  size_bytes    INT,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  reporter_role   VARCHAR(10) NOT NULL CHECK (reporter_role IN ('customer','provider')),
  reporter_id     UUID NOT NULL,
  reason          TEXT NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','warned','provider_suspended')),
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  resolution_note TEXT,
  retain_until    TIMESTAMPTZ,               -- set when resolved: resolved date + retention days
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS report_snapshots (   -- copy of reported messages: the only chat content admins can read
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   UUID NOT NULL REFERENCES message_reports(id) ON DELETE CASCADE,
  sender_role VARCHAR(10) NOT NULL,
  content_enc TEXT,
  has_image   BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at     TIMESTAMPTZ NOT NULL,
  is_reported BOOLEAN NOT NULL DEFAULT FALSE      -- TRUE = reported message, FALSE = context message
);

-- ---------- 7. NOTIFICATIONS ----------
CREATE TABLE IF NOT EXISTS notifications (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_kind VARCHAR(10) NOT NULL CHECK (recipient_kind IN ('user','customer')),
  recipient_id   UUID NOT NULL,
  type           VARCHAR(40) NOT NULL,
  message        TEXT NOT NULL,
  link           VARCHAR(200),
  read_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_rec ON notifications(recipient_kind, recipient_id, created_at DESC);

-- ---------- 8. LOGS, POLICIES, SETTINGS, BLOCKCHAIN PROOFS ----------
CREATE TABLE IF NOT EXISTS system_activity (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role  VARCHAR(20),
  action      VARCHAR(80) NOT NULL,
  entity      VARCHAR(40),
  entity_id   TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_time ON system_activity(created_at DESC);

CREATE TABLE IF NOT EXISTS security_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role  VARCHAR(20),
  event_type  VARCHAR(60) NOT NULL,           -- login_success, login_failed, access_denied, report_viewed ...
  severity    VARCHAR(10) NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  ip_address  VARCHAR(60),
  user_agent  TEXT,
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_seclog_time ON security_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS security_policies (
  key         VARCHAR(60) PRIMARY KEY,
  value       TEXT NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS app_settings (
  key         VARCHAR(60) PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_records (     -- blockchain anchoring queue and proofs (phase 2)
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  VARCHAR(40) NOT NULL,
  entity_id    TEXT NOT NULL,
  record_hash  CHAR(64) NOT NULL,
  tx_hash      VARCHAR(80),
  block_number BIGINT,
  status       VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','anchored','failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  anchored_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ledger_status ON ledger_records(status);

-- =====================================================================
-- REFERENCE DATA
-- =====================================================================
INSERT INTO roles (name, description, is_registered) VALUES
 ('customer','Finds and requests services. No permanent account, verified by phone OTP.', FALSE),
 ('provider','Registered service provider managing own profile, services, chats and requests.', TRUE),
 ('admin','System administrator managing providers, categories, requests and reports.', TRUE),
 ('security_admin','Manages roles, permissions, security logs and policies.', TRUE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO modules (code, name) VALUES
 ('browse','Customer services and search'),
 ('categories','Service categories'),
 ('provider_profiles','Provider profiles'),
 ('services','Service management'),
 ('messaging','In-app messaging'),
 ('message_reports','Message reports'),
 ('service_requests','Service requests and tracking'),
 ('reviews','Reviews and ratings'),
 ('notifications','Notifications'),
 ('administration','Administration'),
 ('system_activity','System activity reports'),
 ('security_administration','Security administration')
ON CONFLICT (code) DO NOTHING;

-- Permission matrix: (role, module, read, write)
INSERT INTO role_permissions (role_id, module_id, can_read, can_write)
SELECT r.id, m.id, p.r, p.w FROM (VALUES
 ('customer','browse',TRUE,FALSE),('customer','categories',TRUE,FALSE),('customer','provider_profiles',TRUE,FALSE),
 ('customer','services',TRUE,FALSE),('customer','messaging',TRUE,TRUE),('customer','message_reports',FALSE,TRUE),
 ('customer','service_requests',TRUE,TRUE),('customer','reviews',TRUE,TRUE),('customer','notifications',TRUE,TRUE),

 ('provider','browse',TRUE,FALSE),('provider','categories',TRUE,FALSE),('provider','provider_profiles',TRUE,TRUE),
 ('provider','services',TRUE,TRUE),('provider','messaging',TRUE,TRUE),('provider','message_reports',FALSE,TRUE),
 ('provider','service_requests',TRUE,TRUE),('provider','reviews',TRUE,FALSE),('provider','notifications',TRUE,TRUE),

 ('admin','browse',TRUE,FALSE),('admin','categories',TRUE,TRUE),('admin','provider_profiles',TRUE,TRUE),
 ('admin','services',TRUE,FALSE),('admin','messaging',FALSE,FALSE),('admin','message_reports',TRUE,TRUE),
 ('admin','service_requests',TRUE,FALSE),('admin','reviews',TRUE,FALSE),('admin','notifications',TRUE,TRUE),
 ('admin','administration',TRUE,TRUE),('admin','system_activity',TRUE,FALSE),

 ('security_admin','notifications',TRUE,TRUE),('security_admin','system_activity',TRUE,FALSE),
 ('security_admin','security_administration',TRUE,TRUE)
) AS p(role_name, module_code, r, w)
JOIN roles r ON r.name = p.role_name
JOIN modules m ON m.code = p.module_code
ON CONFLICT (role_id, module_id) DO NOTHING;

INSERT INTO districts (name) VALUES
 ('Maseru'),('Berea'),('Leribe'),('Botha-Bothe'),('Mafeteng'),
 ('Mohale''s Hoek'),('Quthing'),('Qacha''s Nek'),('Thaba-Tseka'),('Mokhotlong')
ON CONFLICT (name) DO NOTHING;

INSERT INTO categories (name, slug, description, icon) VALUES
 ('Plumbing','plumbing','Pipes, leaks, geysers and bathrooms','plumbing'),
 ('Electrical Services','electrical','Wiring, repairs and installations','electrical'),
 ('Carpentry','carpentry','Furniture, doors and roofing wood work','carpentry'),
 ('Cleaning Services','cleaning','Home and office cleaning','cleaning'),
 ('Mechanics','mechanics','Vehicle repairs and servicing','mechanics'),
 ('Painting','painting','Interior and exterior painting','painting'),
 ('Gardening and Landscaping','gardening','Gardens, lawns and landscaping','gardening'),
 ('Appliance Repairs','appliance-repairs','Fridges, stoves, washing machines','appliance')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO security_policies (key, value, description) VALUES
 ('max_login_attempts','5','Failed logins before an account is locked'),
 ('lockout_minutes','15','How long a locked account stays locked'),
 ('otp_ttl_minutes','5','How long a phone OTP is valid'),
 ('otp_max_attempts','5','Wrong OTP entries allowed per code'),
 ('retention_chat_days','90','Days to keep a chat with no service request after the last message'),
 ('retention_request_chat_days','365','Days to keep a chat linked to a request after it closes'),
 ('retention_report_days','30','Days to keep report snapshots after a report is resolved'),
 ('report_context_messages','3','Messages kept before and after a reported message for context')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value) VALUES
 ('app_name','Find a Service Provider'),
 ('support_phone','+266 0000 0000'),
 ('support_email','support@example.com')
ON CONFLICT (key) DO NOTHING;
