# Shared voices server

`voices-worker.js` is a Cloudflare Worker that holds the OpenAI key so people in Shannon's groups can use the AI voices and page reading without a key of their own. It only serves people who are signed in with Google and in one of Shannon's groups, keeps a rough monthly allowance per person, and never sends the key to anyone's device.

## Set it up (Cloudflare dashboard)

1. **Make a separate OpenAI key.** At platform.openai.com, create a project called "Line Learner shared", set its monthly **budget** (Settings > Limits), and create a key in that project.
2. **Create the Worker.** In Cloudflare: **Workers & Pages > Create > Create Worker**, name it `line-learner-voices`, and **Deploy**. Then **Edit code**, replace everything with the contents of `voices-worker.js`, and **Deploy** again.
3. **Add its settings.** In the Worker: **Settings > Variables and Secrets > Add**:
   - `OPENAI_API_KEY` (type **Secret**): the key from step 1
   - `OWNER_UID`: Shannon's account ID (in the app: Group screen > "Account ID (for setting up shared voices)" > Copy)
   - `FIREBASE_PROJECT_ID`: `line-learner-45bd1`
   - `ALLOWED_ORIGIN`: `https://sqnazzal.github.io`
   - `USER_MONTHLY_USD` (optional): each person's monthly allowance in dollars, default `2`
4. **Per-person allowances (recommended).** **Storage & Databases > D1 > Create**, name it `line-learner-usage`. In its **Console**, run:
   ```sql
   CREATE TABLE usage (uid TEXT, month TEXT, usd REAL, PRIMARY KEY (uid, month));
   ```
   Then in the Worker: **Settings > Bindings > Add > D1 database**, variable name `DB`, database `line-learner-usage`.
5. **Connect the app.** The Worker's address goes in `SHARED_VOICES_URL` in `app.js` (currently `https://line-learner-voices.sqnazzal.workers.dev`).
6. **Feedback emails (optional).** Sign up at [resend.com](https://resend.com) (free), then **API Keys > Create API key** with **Sending access**. In the Worker's **Settings > Variables and Secrets** add:
   - `RESEND_API_KEY` (type **Secret**): the key
   - `FEEDBACK_EMAIL`: the email address you signed up to Resend with (Resend's free test sender only mails that address)

   Each note sent with **Send feedback** then arrives by email with the device details and any screenshot attached; reply to it to answer the sender if they left an email address.
7. **Google key for the Worker (needed for feedback emails and for everyone in Admin > People).** Read-only access for the Worker to the sign-in list and to new feedback notes:
   1. Open [console.cloud.google.com/iam-admin/serviceaccounts?project=line-learner-45bd1](https://console.cloud.google.com/iam-admin/serviceaccounts?project=line-learner-45bd1) and tap **Create service account**. Name it `admin-people-list`, **Create and continue**.
   2. Roles: **Firebase Authentication Viewer** and **Cloud Datastore Viewer** (add another role for the second), nothing else. **Continue**, **Done**.
   3. Open the new account > **Keys > Add key > Create new key > JSON**. A file downloads.
   4. In the Worker: **Settings > Variables and Secrets > Add**, type **Secret**, name `GOOGLE_SERVICE_ACCOUNT`, and paste the whole file's contents. Then delete the downloaded file.

   Without it, no feedback emails are sent (notes still appear in Admin), and People only shows those who have opened the app signed in since the Admin screen was added. Feedback notes are private: since this change the Worker reads them with this key rather than publicly, and it sends at most 20 alert emails an hour.

## How it decides

- Checks the Google sign-in token is genuine (signed by Google, for this Firebase project, not expired).
- Asks Firestore, as that person, whether they're in a group whose owner is `OWNER_UID`.
- Shannon (the owner) has no allowance limit; everyone else gets `USER_MONTHLY_USD` a month (estimated: about $15 per million characters of speech, a fifth of a cent per page read).
- The OpenAI project budget is the hard cap on the total.
