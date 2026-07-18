# Backup & Rollback Guide

This guide explains how version backups are tracked and how to perform instant rollbacks if something breaks.

---

## 1. How to View & Download Backups (GitHub)
Every stable version of the app is tagged and saved as a release on GitHub.

1. Go to your repository: https://github.com/tendulkar1976/campusbusmove
2. On the right sidebar, click on **Releases** (or click **Tags**).
3. You will see **v1.0.0** (and future versions like v1.1.0).
4. You can click **Source code (zip)** to download the exact backup of the code at that specific version.

---

## 2. How to Perform 1-Click Rollbacks (Vercel)
If a newly pushed update causes errors on the live website or mobile app, you can roll back to the previous stable version in 2 seconds:

1. Go to your Vercel Dashboard: https://vercel.com/
2. Select your project: **campusbusmove**
3. Click on the **Deployments** tab.
4. Locate the last successful/working deployment in the list (it will show the version tag, e.g., v1.0.0).
5. Click the three dots ... on the right side of that deployment.
6. Select **Instant Rollback**.
7. Confirm the rollback. 

Vercel will instantly route all live traffic (web and mobile app) back to the safe backup version.
