# Document search: connecting Microsoft 365 (for Ilies, one time, about 15 minutes)

Operations reads the approved SharePoint folders through a Microsoft 365 "app" that can only **read**, and only the
**Management** site. You set it up once as the Microsoft 365 admin. Claude never sees the secret.

You need: a Microsoft 365 **Global Administrator** sign-in, and the laptop.

## 0. First: move the passwords sheet (security review DSO-004)

The app can technically read the **whole** Management site; only Operations' folder list holds it back. The library
root holds **"Passwords sheet - Victoria .xlsx"**. Before step 4, move those logins into a password manager (or at
least out of the Management site) and delete the sheet. Claude has never opened it and never will.

## 1. Register the app (Microsoft Entra admin centre)

1. Go to **entra.microsoft.com** and sign in as the admin.
2. **Identity → Applications → App registrations → New registration.**
   - Name: `Operations document search`
   - Supported account types: **Accounts in this organizational directory only**
   - Redirect URI: leave empty
   - Press **Register**.
3. On the app's **Overview** page, copy these two and keep them handy (they aren't secret):
   - **Application (client) ID**
   - **Directory (tenant) ID**

## 2. Give it read access to SharePoint - one permission only

1. In the app: **API permissions → Add a permission → Microsoft Graph → Application permissions.**
2. Search **Sites.Selected**, tick it, **Add permissions**.
3. Press **Grant admin consent for Lobos…** and confirm. The status turns green.
4. If **User.Read** is listed, remove it (⋯ → Remove permission). Operations refuses to start if the app has any
   permission besides Sites.Selected.

> Sites.Selected on its own opens **nothing**. Step 4 is what opens the Management site, read-only.

## 3. Create the secret

1. In the app: **Certificates & secrets → Client secrets → New client secret.**
   - Description: `Operations server`
   - Expires: **12 months** (DSO-004 - Claude adds a reminder for the expiry date)
2. Copy the **Value** straight away (it's shown once). Not the "Secret ID".
3. Don't paste it anywhere except step 5 - not in an email, chat or file.

## 4. Allow it to read the Management site (Graph Explorer)

1. Go to **developer.microsoft.com/graph/graph-explorer** and sign in (top right) as the admin.
2. Press **Modify permissions**, find **Sites.FullControl.All**, press **Consent**. (This is for your admin session in
   Graph Explorer only, to hand out the read access. It isn't given to Operations.)
3. Find the site's id. Set the method to **GET** and the address to:
   `https://graph.microsoft.com/v1.0/sites/lobosdemolition.sharepoint.com:/sites/Management`
   Press **Run query**. In the answer, copy the value of **"id"** (it looks like
   `lobosdemolition.sharepoint.com,xxxxxxxx-…,xxxxxxxx-…`).
4. Grant the read access. Set the method to **POST** and the address to
   `https://graph.microsoft.com/v1.0/sites/<the id you copied>/permissions`
   and paste this into **Request body**, putting in the Application (client) ID from step 1:

   ```json
   {
     "roles": ["read"],
     "grantedToIdentities": [
       { "application": { "id": "<Application (client) ID>", "displayName": "Operations document search" } }
     ]
   }
   ```

   Press **Run query**. A green **201 Created** means it's done.
5. **Check it says read only.** Set the method back to **GET**, same address
   (`https://graph.microsoft.com/v1.0/sites/<the id>/permissions`), **Run query**. You should see one entry for
   "Operations document search" with `"roles": ["read"]` - not "write" or "fullcontrol". If it says anything else,
   stop and tell Claude.
6. Only this one site is granted. Don't grant any other site.
7. Back in Graph Explorer, **Modify permissions → Sites.FullControl.All → Revoke** (you only needed it for step 4).

## 5. Put the keys on the server (hidden)

In the laptop's terminal, run:

```
ssh -t -i ~/.ssh/lobos_ops_lightsail ubuntu@52.64.25.179 sudo graph-keys
```

It asks for the **Directory (tenant) ID**, the **Application (client) ID** and the secret **Value**. The secret isn't
shown as you paste it. It checks the shape, saves the three keys into the server's settings, and restarts Operations
(a few seconds).

## 6. What happens next

- From **2:30am** that night Operations reads the approved folders (the first run can take a few hours). Or an Admin
  presses **Refresh now** on **Documents** (at most every 15 minutes).
- If Microsoft says the app has more than Sites.Selected, Operations stops and says so - nothing is read.
- **Calendar:** the secret expires in 12 months. Make a new one in step 3 before then and run step 5 again.
- After the first run, Claude checks the results with you: counts per folder, nothing outside the 20, and (counts
  only, no figures) how many site & safety documents mention dollar amounts.
- To switch document search off at any time: `DOC_SEARCH=off` in the server's settings (ask Claude).
