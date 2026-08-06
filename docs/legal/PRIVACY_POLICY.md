# Privacy Policy for Shift@PennHousing

**Effective Date:** August 6, 2026
**Last Updated:** August 6, 2026

## 1. Introduction

This Privacy Policy describes how Shift@PennHousing ("the App," "we," "us," or "our") collects, uses, discloses, and safeguards information when Penn Housing student workers, Service Managers (SM), House Managers (HM), Building Administrators (BA), and other authorized staff ("you" or "Users") use the App on iOS, Android, or the web.

Shift@PennHousing is developed and maintained by Andrew Chelimo ("the Developer") for internal use by University of Pennsylvania Housing staff. It is **not** distributed on the public App Store or Google Play Store, and it is **not** available for use by the general public. Access is restricted to individuals who have been onboarded by Penn Housing management.

If you do not agree with the terms of this Privacy Policy, please do not access or use the App. Questions about this policy should be directed to your Penn Housing administrator or to the Developer at the contact listed in Section 12.

## 2. Scope

This Policy applies to the Shift@PennHousing mobile applications (iOS and Android) and the Shift@PennHousing web application (collectively, "the App"), and to any data processed through them. It does not apply to third-party websites, services, or applications that the App may link to, even if accessed through the App.

## 3. Information We Collect

We collect only the information reasonably necessary to operate a staff scheduling and desk-coverage system. We do **not** collect data for advertising, do **not** sell personal information, and do **not** use the App to build advertising profiles.

### 3.1 Identity and Contact Information

- Full name
- University of Pennsylvania email address (used for account sign-in)
- Phone number (where provided, for contact-card and coverage-coordination purposes)
- Assigned house/residence (e.g., Harnwell) and role (Student Worker, SM, RSM, HM, BM/BA, Admin)

### 3.2 Schedule and Work Data

- Shift assignments, scheduled hours, and shift history
- Shift claims, drops, swaps, floats, and permanent transfers
- Break requests and assignments
- Weekly hours worked, for cap enforcement
- Preference submissions (availability, shift preferences) used in schedule building
- Leave requests and approvals

### 3.3 Device and Push Notification Data

- Push notification device tokens, collected and delivered through Firebase Cloud Messaging (FCM), which in turn routes notifications to Apple Push Notification service (APNs) on iOS devices
- These tokens are used solely to deliver time-sensitive operational notifications: shift assignments, float requests, acknowledgment reminders, swap requests, and schedule updates
- We do not use push infrastructure for marketing or promotional messages

### 3.4 AI-Assisted Scheduling Data

When a manager (SM/HM/BM/RSM/Admin) uses the AI-assisted schedule-building feature, relevant scheduling inputs (worker availability, preferences, house staffing requirements, and existing shift patterns) are sent to Anthropic's Claude API to generate a proposed schedule. This processing:

- Is limited to schedule-construction data — house rosters, availability, and staffing rules
- Is initiated only when a manager affirmatively triggers AI schedule generation
- Does not include free-form personal chat, health information, or unrelated personal content
- Is subject to Anthropic's own data handling terms as our sub-processor for this specific function (see Section 6)

### 3.5 Information We Do Not Collect

We do not collect: precise GPS/location data, biometric identifiers, payment or financial account information, government identification numbers, health information, or social media account data. We do not access your device's camera, microphone, contacts, or photo library.

### 3.6 Automatically Collected Technical Information

Standard operational logs (timestamps of actions, error logs, authentication events) are recorded for security, debugging, and audit purposes. These logs are retained only as long as necessary for those purposes.

## 4. How We Use Your Information

We use the information described in Section 3 exclusively to:

1. Authenticate you and maintain your account
2. Build, publish, and display work schedules
3. Route and deliver shift coverage (claims, drops, swaps, floats, and automated escalation to available coverage)
4. Enforce scheduling rules, including hours caps and house-eligibility restrictions
5. Send operational push notifications about your shifts and required actions
6. Generate AI-assisted schedule proposals for manager review (Section 3.4)
7. Maintain audit records required for staffing accountability
8. Diagnose and fix technical issues

We do not use your information for advertising, do not build behavioral profiles for marketing, and do not sell, rent, or trade your information to third parties.

## 5. Legal Basis for Processing

Where applicable data protection law requires a stated legal basis, we process your information on the following grounds: (a) performance of your work/staffing relationship with Penn Housing, (b) our legitimate interest in operating a functional, secure staff-scheduling system, and (c) compliance with applicable university and legal obligations.

## 6. Third-Party Service Providers

We share information only with service providers who process data on our behalf, under obligations consistent with this Policy. We do not permit these providers to use your information for their own independent purposes.

| Provider                                            | Purpose                                                  | Data Involved                                           |
| --------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| Supabase                                            | Database hosting, authentication, backend infrastructure | All data described in Section 3                         |
| Firebase (Google) / Apple Push Notification service | Push notification delivery                               | Device push tokens, notification content                |
| Anthropic (Claude API)                              | AI-assisted schedule generation (Section 3.4 only)       | Scheduling/availability data, not personal chat content |
| Vercel                                              | Web application hosting                                  | Data transmitted to the web app                         |

We may also disclose information where required to comply with a legal obligation, protect the rights and safety of Users, or investigate suspected misuse of the App, and to University of Pennsylvania Housing administration in the ordinary course of staffing operations (this is the App's core function, not a "third-party disclosure" in the ordinary sense, since Penn Housing management is the operator of the underlying staffing program).

## 7. Data Retention

We retain your information for as long as your account remains active and for a reasonable period thereafter to satisfy staffing-record, audit, and legal recordkeeping needs. Upon separation from Penn Housing employment, your account is deactivated; historical shift and hours records may be retained as required for institutional recordkeeping. You may request deletion of your account information as described in Section 9, subject to any records we are required to retain by law or university policy.

## 8. Data Security

We implement administrative, technical, and physical safeguards designed to protect your information, including role-based access controls, row-level security enforced at the database layer, encrypted transport (TLS) for all data in transit, and restricted service-role access to backend systems. No method of electronic storage or transmission is 100% secure, and we cannot guarantee absolute security.

## 9. Your Rights and Choices

Depending on your circumstances, you may have the right to:

- **Access** the personal information we hold about you
- **Correct** inaccurate information (e.g., contact details)
- **Request deletion** of your account information, subject to Section 7
- **Withdraw consent** for push notifications by disabling them in your device settings (note: this may affect your ability to receive time-sensitive coverage requests)
- **Object to or restrict** certain processing, where applicable law provides this right

To exercise these rights, contact us using the information in Section 12. We will respond within a reasonable time and in accordance with applicable law.

## 10. Children's Privacy

The App is intended solely for use by Penn Housing student workers and staff, who are university students or employees. The App is not directed to, and we do not knowingly collect information from, children under the age of 13.

## 11. Changes to This Policy

We may update this Privacy Policy from time to time to reflect changes in the App's functionality or legal requirements. We will update the "Last Updated" date above and, for material changes, provide notice through the App or through Penn Housing administration. Continued use of the App after changes take effect constitutes acceptance of the revised Policy.

## 12. Contact Us

For questions, requests, or concerns about this Privacy Policy or your information, contact:

**Andrew Chelimo**
Email: andrewchelimo2000@gmail.com

You may also raise data-related questions with your Penn Housing manager, who can escalate to the Developer on your behalf.
