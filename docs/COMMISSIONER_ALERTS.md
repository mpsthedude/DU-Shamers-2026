# Commissioner phone alerts

Web Push alerts are available from the commissioner queue. On iPhone (iOS 16.4+), open https://dushamers.com in Safari, choose Share → Add to Home Screen, open the installed app, sign in, and choose **Enable alerts on this device**. Accept the system permission prompt, then choose **Send test alert**. These are app notifications, not SMS. Focus mode and device notification settings can suppress them.

A committed weekly proposal queues one alert per subscribed commissioner device. The scheduler checks every minute and sends only while the proposal awaits placement and its deadline has not passed. Notifications open the commissioner queue. Existing proposals are not retrospectively announced. There is no sports-data or AI request associated with sending an alert.

Subscriptions require a confirmed, active owner who is also commissioner-allowlisted and has commissioner membership. Delivery checks authorization again. Each commissioner may enable five devices; tests are limited to one per minute. Disabling a device removes its pending deliveries. Expired push endpoints are removed after a 404/410 response.

VAPID keys are generated once on the first authorized setup request and stored in the service-only `push_config` table. Do not rotate them without planning to re-enroll devices. Subscriptions and deliveries are also service-only. Only known browser push-service hosts are accepted, and requests cannot follow redirects. The service worker has no page or API cache.

Temporary failures retry after five minutes, at most three attempts per delivery. Jobs older than 24 hours are not sent. A repeated delivery uses the same notification tag to replace an earlier notification if a response was lost. `SENT` means the push service accepted it; it does not prove that the device displayed it. `FAILED` and expired subscriptions can be checked in `push_deliveries` / `push_subscriptions`; the controls report the latest failed delivery. A crash on the final attempt can leave `SENDING` with three attempts; it will not be retried. No automatic wager placement occurs.

The cron invocation is public but accepts only a fixed queue-drain request; it cannot add jobs or specify content or recipients. Registration, status, disable, and test requests authenticate the commissioner on the server. Delivery is best effort; the review queue remains the source of truth.

Validation: `node --test tests/*.test.cjs`, rollback-only `tests/commissioner-push.sql`, and an actual iPhone test after enabling notifications. Browser simulation does not establish real device delivery.
