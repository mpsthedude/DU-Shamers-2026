# Owner accounts and email delivery

## Configuration completed September 7, 2026

- Custom SMTP saved in Supabase: `smtp.resend.com`, port 465, username `resend`, sender `DU Shamers <league@dushamers.com>`. Existing send-only Resend API key entered securely; no credential copied into tracked files.
- Production Site URL and the exact `?account=setup` redirect below are saved and verified in the dashboard.
- Public signups disabled; email confirmations and secure email changes remain enabled. Minimum password length is 8, current password is required for normal password changes, email link expiration is 3600 seconds. Recovery sessions and initial password setup are exempt from the current-password check in Supabase Auth.
- Invitation subject `Your DU Shamers 2026 invitation` and recovery subject `Reset your DU Shamers password`, with the two repository HTML templates, saved and previewed in Supabase.
- Resend reports DNS verified but final domain status remains Pending. No invitation emails sent. AUTH_INVITATIONS_ENABLED remains off pending actual delivery/account tests. First commissioner invitation and end-to-end password tests are still required.

The account UI supports invitation links, email/password sign-in, password recovery, and changing a password with the current password. Password saves end Supabase refresh sessions globally and return the owner to sign-in. Already-issued access tokens expire according to the project's JWT lifetime.

Access is restricted server-side to a private owner directory matched against the verified email returned by Supabase Auth. Team IDs remain stable across team name changes. Owner addresses are never shipped in site assets. Only the commissioner can read the invitation directory or send invitations.

## Setup reference and remaining delivery test

1. Create a Resend account and verify a domain or sending subdomain you own using the DNS records Resend supplies. The site can remain on GitHub Pages. Stay on the free transactional plan for this league's volume.
2. Configure custom SMTP in Supabase Auth using the Resend integration and a verified sender, display name `DU Shamers`. Keep the SMTP/API password out of the repository and browser assets. Turn off email link tracking to preserve authentication links.
3. Set Supabase Auth Site URL to `https://mpsthedude.github.io/DU-Shamers-2026/` and allow the exact redirect `https://mpsthedude.github.io/DU-Shamers-2026/?account=setup`.
4. Disable public signups, keep email confirmation enabled, and set minimum password length to 8. The frontend validates 8–128 characters; the server setting must enforce the minimum too. Review Auth email rate limits for a 12-owner rollout. Use the templates in `supabase/templates` for Invite User and Reset Password, preserving `{{ .ConfirmationURL }}`.
5. After the private directory has been imported, invite the commissioner once from Supabase's Auth dashboard. Open that email, choose a password, then sign in. The verified mapped email and private commissioner allowlist establish the commissioner role automatically.
6. Once delivery and redirect behavior are confirmed, set Edge Function secret `AUTH_INVITATIONS_ENABLED=true`. The commissioner console then enables individual owner invitations. No automatic bulk sends run on page load.
7. Test an owner invitation, password reset, wrong current password rejection, successful account password change, and sign-in from another browser. Until these real email tests pass, email delivery is not verified.

Invitation attempts are reserved atomically. Successful sends are not automatically repeated; failed sends have a one-hour cooldown. An ambiguous delivery or interrupted send is marked UNKNOWN/SENDING and requires checking Auth and email logs before retrying. For an expired invitation, review the user in the Supabase Auth dashboard and issue the appropriate new invitation or recovery email. Do not reset tracking and resend blindly.

Owner email/ownership changes require updating the private directory and reconciling any existing membership; the server rejects conflicting assignments. A team rename alone requires no directory change.

References: [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Resend integration](https://supabase.com/partners/resend), [Resend quotas](https://resend.com/docs/knowledge-base/account-quotas-and-limits).
