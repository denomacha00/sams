import React from 'react';
import { Link } from 'react-router-dom';

/**
 * Public Terms & Conditions page for SAMS.
 *
 * NOTE: This is a good-faith template covering the key areas for a Kenyan
 * multi-school attendance SaaS (including biometric data under the Data
 * Protection Act, 2019). It is NOT a substitute for review by a qualified
 * lawyer before you rely on it commercially.
 */
const EFFECTIVE_DATE = '28 July 2026';

const Section: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <section className="mb-8">
    <h2 className="text-lg font-bold text-ink mb-2">
      {n}. {title}
    </h2>
    <div className="text-sm text-ink-muted leading-relaxed space-y-3">{children}</div>
  </section>
);

const TermsPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-canvas px-6 py-12">
      <div className="w-full max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="inline-flex w-10 h-10 rounded-xl bg-brand items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-ink">SAMS — Terms &amp; Conditions</h1>
        </div>
        <p className="text-xs text-ink-subtle mb-8">Effective date: {EFFECTIVE_DATE}</p>

        <div className="surface-card p-8">
          <p className="text-sm text-ink-muted leading-relaxed mb-8">
            These Terms &amp; Conditions (&ldquo;Terms&rdquo;) govern your access to and use of the Smart
            Attendance Management System (&ldquo;SAMS&rdquo;, &ldquo;the Service&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), a
            multi-school platform for attendance, records, and school administration. By creating an
            account, activating a school, or otherwise using SAMS, you agree to these Terms. If you do
            not agree, do not use the Service.
          </p>

          <Section n={1} title="Eligibility & Accounts">
            <p>
              SAMS is provided to registered educational institutions and the staff, students, and
              guardians they authorise. Accounts are created by your school administrator or through an
              approved registration link. You are responsible for the accuracy of the information you
              provide.
            </p>
            <p>
              Where a user is a minor, the school and/or the student&rsquo;s parent or guardian is
              responsible for consenting to and supervising that user&rsquo;s access on their behalf.
            </p>
          </Section>

          <Section n={2} title="Account Security">
            <p>
              You are responsible for keeping your login credentials confidential and for all activity
              under your account. Do not share passwords or one-time codes. Notify your school
              administrator immediately if you suspect unauthorised access. For security, sessions
              expire and require you to sign in again periodically.
            </p>
          </Section>

          <Section n={3} title="Acceptable Use">
            <p>You agree not to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>access data belonging to another school, class, or user without authorisation;</li>
              <li>attempt to probe, scan, or breach the security of the Service or bypass access controls;</li>
              <li>upload malware, or content that is unlawful, defamatory, or infringing;</li>
              <li>use automated means to overload the Service or the AI assistant, or to scrape data;</li>
              <li>misuse the AI assistant to generate harmful, misleading, or unlawful content.</li>
            </ul>
            <p>We may suspend or terminate access that violates these rules.</p>
          </Section>

          <Section n={4} title="Attendance & Biometric Data">
            <p>
              SAMS may process attendance data captured via QR codes, GPS/location, and biometric
              methods (such as facial recognition and fingerprints) where the school has enabled them.
              Biometric data is sensitive personal data. It is used solely to verify identity for
              attendance, is stored in encrypted form, and is not sold or used for advertising.
            </p>
            <p>
              Schools must obtain any consent required under the Kenya Data Protection Act, 2019 (and
              any other applicable law) before enrolling users in biometric attendance, and must offer a
              reasonable non-biometric alternative where required.
            </p>
          </Section>

          <Section n={5} title="Data Protection & Privacy">
            <p>
              We process personal data to provide the Service, in line with the Kenya Data Protection
              Act, 2019. Each school is the data controller for its own users&rsquo; data; SAMS acts as a
              data processor on the school&rsquo;s instructions. We apply technical and organisational
              measures — including encryption, access controls, and audit logging — to protect personal
              data. You may request access to or correction of your data through your school
              administrator.
            </p>
          </Section>

          <Section n={6} title="Licensing & Fees">
            <p>
              Use of SAMS by a school is subject to a valid licence. Fees, licence duration, and renewal
              terms are as agreed with the school. Access may be suspended if a licence expires or fees
              are unpaid. Fees already paid are non-refundable except where required by law.
            </p>
          </Section>

          <Section n={7} title="Intellectual Property">
            <p>
              SAMS, including its software, design, and content (excluding data you or your school
              upload), is owned by its developer and is protected by law. You receive a limited,
              non-exclusive, non-transferable right to use the Service for its intended purpose. Data
              your school uploads remains the property of the school.
            </p>
          </Section>

          <Section n={8} title="AI Assistant">
            <p>
              SAMS includes an AI assistant. AI responses may be inaccurate or incomplete and should not
              be relied upon as professional, legal, or medical advice. Do not enter another
              person&rsquo;s sensitive data into the assistant beyond what your role permits. School data
              is only accessible to signed-in, authorised users.
            </p>
          </Section>

          <Section n={9} title="Service Availability">
            <p>
              We aim to keep SAMS available and reliable but do not guarantee uninterrupted service.
              Maintenance, updates, or factors beyond our control may cause downtime. We may modify or
              discontinue features with reasonable notice where practicable.
            </p>
          </Section>

          <Section n={10} title="Disclaimers & Limitation of Liability">
            <p>
              The Service is provided &ldquo;as is&rdquo; without warranties of any kind to the extent
              permitted by law. To the maximum extent permitted by law, we are not liable for indirect,
              incidental, or consequential losses, or for loss of data arising from your failure to keep
              credentials secure. Nothing in these Terms excludes liability that cannot be excluded by
              law.
            </p>
          </Section>

          <Section n={11} title="Termination">
            <p>
              A school or user may stop using the Service at any time. We may suspend or terminate access
              for breach of these Terms, non-payment, or where required by law. On termination, data is
              handled in accordance with the school&rsquo;s instructions and applicable law.
            </p>
          </Section>

          <Section n={12} title="Changes to These Terms">
            <p>
              We may update these Terms from time to time. Material changes will be notified through the
              Service or to your school administrator. Continued use after changes take effect
              constitutes acceptance.
            </p>
          </Section>

          <Section n={13} title="Governing Law">
            <p>
              These Terms are governed by the laws of the Republic of Kenya, and any disputes are subject
              to the exclusive jurisdiction of the Kenyan courts.
            </p>
          </Section>

          <Section n={14} title="Contact">
            <p>
              Questions about these Terms or your data can be directed to your school administrator, or
              to the SAMS team: Denis Macharia,{' '}
              <a href="tel:+254703285246" className="text-brand hover:text-brand-hover">+254 703 285 246</a>.
            </p>
          </Section>

          <p className="text-xs text-ink-subtle border-t border-line pt-6 mt-2">
            This document is a general template and does not constitute legal advice. Have it reviewed by
            a qualified lawyer and your Data Protection Officer before commercial use.
          </p>
        </div>

        {/* Footer */}
        <div className="text-center mt-6">
          <Link to="/login" className="text-sm text-brand hover:text-brand-hover font-medium">
            ← Back to sign in
          </Link>
          <p className="text-xs text-ink-subtle mt-3">© 2026 SAMS · Smart Attendance Management System</p>
        </div>
      </div>
    </div>
  );
};

export default TermsPage;
