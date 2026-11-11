const ExcelJS = require('exceljs');

async function generateSheets() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FSP Application';

  // ==========================================
  // SHEET 1: DATA CLASSIFICATION (C.1)
  // ==========================================
  const sheet1 = workbook.addWorksheet('C1_Data_Classification');
  
  sheet1.columns = [
    { header: 'Data Element', key: 'element', width: 30 },
    { header: 'Location / Database Table', key: 'location', width: 35 },
    { header: 'Classification Level', key: 'level', width: 20 },
    { header: 'Justification', key: 'justification', width: 50 }
  ];

  const data1 = [
    ['Provider Business Name', 'providers.business_name', 'Public', 'Needed for customers to search and find services.'],
    ['Service Categories', 'categories.name', 'Public', 'Public catalogue data.'],
    ['Service Prices', 'services.price', 'Public', 'Must be visible for customers to compare prices.'],
    ['Provider Availability', 'providers.availability', 'Private', 'Internal business data; only relevant during booking.'],
    ['System Activity Logs', 'system_activity.action', 'Private', 'Internal moderation data for Administrators.'],
    ['Customer Phone Number', 'customer_identities.phone', 'Confidential', 'Personally Identifiable Information (PII). Used for OTP.'],
    ['Chat Messages', 'messages.content_enc', 'Confidential', 'Private communication. Encrypted at rest (AES-256).'],
    ['Service Request Details', 'service_requests.description', 'Confidential', 'Contains user location and personal job needs.'],
    ['Passwords (Hashed)', 'users.password_hash', 'Restricted', 'Severe risk if leaked; hashed with bcrypt.'],
    ['OTP Codes (Hashed)', 'otp_codes.code_hash', 'Restricted', 'Temporary authentication secrets.'],
    ['Blockchain Keys', 'FSP_APP_PRIVATE_KEY', 'Restricted', 'Compromise breaks blockchain integrity and signatures.']
  ];

  data1.forEach(row => sheet1.addRow({ element: row[0], location: row[1], level: row[2], justification: row[3] }));

  // Style Sheet 1
  sheet1.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet1.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0056b3' } };

  // ==========================================
  // SHEET 2: GDPR COMPLIANCE (C.3)
  // ==========================================
  const sheet2 = workbook.addWorksheet('C3_GDPR_Compliance');
  
  sheet2.columns = [
    { header: 'GDPR Principle', key: 'principle', width: 35 },
    { header: 'How the FSP Application Complies', key: 'compliance', width: 60 },
    { header: 'Status', key: 'status', width: 20 }
  ];

  const data2 = [
    ['Right to Erasure', 'Customers can delete their data via the "Delete my data" button. The backend deletes chats, files, and anonymizes requests.', 'Compliant'],
    ['Data Minimization', 'We do not create permanent customer accounts. We only ask for a Name and Phone number to verify identity.', 'Compliant'],
    ['Storage Limitation', 'The retention job runs daily and deletes old chats after 90 days (or 365 if linked to a request).', 'Compliant'],
    ['Integrity and Confidentiality', 'Messages are encrypted using AES-256-GCM. The blockchain stores only cryptographic hashes, not raw PII.', 'Compliant'],
    ['Accountability and Audit Logs', 'Security Admins can view a Security Log of failed logins, permission changes, and unauthorized access attempts.', 'Compliant'],
    ['Breach Notification', 'The system flags suspicious IPs and locked accounts in the Security Dashboard for immediate review.', 'Partially Compliant']
  ];

  data2.forEach(row => sheet2.addRow({ principle: row[0], compliance: row[1], status: row[2] }));

  // Style Sheet 2
  sheet2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF28a745' } };

  // ==========================================
  // SAVE THE FILE
  // ==========================================
  await workbook.xlsx.writeFile('FSP_PartC_Security.xlsx');
  console.log('✅ Spreadsheet "FSP_PartC_Security.xlsx" generated successfully!');
}

generateSheets();