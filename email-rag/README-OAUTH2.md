# Microsoft 365 OAuth2 Fallback Guide

If your Microsoft 365 / Exchange Online administrator has disabled "Basic Authentication" or App Passwords for IMAP, you must use **OAuth2 (Modern Authentication)** to connect to your emails.

This guide explains how to set up OAuth2 for this local script using the Microsoft Azure Portal.

## Step 1: Register an App in Azure AD

1. Go to the [Azure Portal](https://portal.azure.com) and sign in with your Microsoft 365 account.
2. Search for and select **Microsoft Entra ID** (formerly Azure Active Directory).
3. In the left menu, select **App registrations**, then click **New registration**.
4. Enter a name (e.g., `LocalEmailRAG`).
5. Under **Supported account types**, choose "Accounts in any organizational directory and personal Microsoft accounts".
6. Under **Redirect URI**, select `Web` or `Public client/native (mobile & desktop)` and enter `http://localhost:8080` (this is used for the interactive login prompt).
7. Click **Register**.

## Step 2: Get your Client ID and Tenant ID

After registering, you will be on the Overview page for your app.
*   Copy the **Application (client) ID**.
*   Copy the **Directory (tenant) ID**.

## Step 3: Add API Permissions

1. In the left menu of your app registration, select **API permissions**.
2. Click **Add a permission**.
3. Select **Microsoft Graph**.
4. Select **Delegated permissions**.
5. Search for and check the following permissions:
    *   `IMAP.AccessAsUser.All` (To read emails via IMAP)
    *   `offline_access` (To get refresh tokens so you don't have to log in every 15 minutes)
    *   `User.Read`
6. Click **Add permissions**.
7. (Optional but recommended if you are an admin): Click **Grant admin consent for [Your Tenant]**.

## Step 4: Create a Client Secret (If using Web flow)
*(Note: If you selected `Public client/native` in step 1.6, you might not need a secret, but it's safer for server-to-server.)*
1. In the left menu, select **Certificates & secrets**.
2. Click **New client secret**.
3. Add a description and choose an expiration.
4. Click **Add**.
5. **CRITICAL:** Copy the **Value** of the secret immediately. You will not be able to see it again.

## Step 5: Update the Script

If you need to use OAuth2, you will use the `msal_auth.py` script provided in this folder.
1. Install MSAL: `pip install msal`
2. Update your `.env` file with the new credentials:
   ```env
   CLIENT_ID="your-client-id-here"
   TENANT_ID="your-tenant-id-here"
   # If you created a secret:
   CLIENT_SECRET="your-client-secret-here"
   ```
3. Run `msal_auth.py` once to get an `access_token`. You will be prompted to log in via your browser.
4. Pass this `access_token` to the IMAP connection instead of an App Password. The token string must be formatted as: `user={email}\x01auth=Bearer {token}\x01\x01`
