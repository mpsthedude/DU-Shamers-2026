# Kentucky trip photos

The gallery at `/kentucky/#photos` starts with two user-supplied photos in the static site. Additional photos supplied in chat can be optimized and added to the seed list in `kentucky/gallery.js` and the public build asset allowlist.

Website uploads use `supabase/functions/trip-photos/index.ts` (deployed with gateway JWT verification off because GET is public; POST always verifies the bearer token with `auth.getUser` and checks confirmed email against the active DU Shamers owner directory). No invitation emails are sent. Existing account sign-in is reused.

Storage bucket: `kentucky-trip-2026`, public image reads, 6 MiB file limit, only `image/jpeg`. No browser storage write/list policies. Only the verified endpoint writes via its server-side service key. The endpoint returns a sanitized public photo list and supports pagination. Recreate the bucket through the Storage administration API with these settings when setting up another environment.

The browser converts decodable photos to JPEG at up to 1800px, removes source EXIF metadata through canvas encoding, and supports up to ten uploads per batch. HEIC support depends on browser decoding; the UI explains how to export JPEG if needed. Uploads appear on the public trip page. Refresh photos loads additions by other members.

Validation: `node --test tests/trip-photos.test.cjs`; `node scripts/build-site.cjs`; desktop/mobile headless Edge checks of arrows, keyboard navigation, thumbnail selection, dialog open/close, overflow and JS errors. Live GET returned 200, anonymous/invalid-token POSTs returned 401. Authenticated upload logic is tested with mocked identity/storage, not a real member session.

Existing project security advisor notes, unrelated to gallery storage: long OTP expiry (https://supabase.com/docs/guides/platform/going-into-prod#security) and leaked-password protection disabled (https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Existing service-only database tables remain unchanged.
