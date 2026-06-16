# GitHub and Vercel Setup

## Project Root

Use this exact folder as the repository and Vercel root:

```text
C:\Users\Admin\Documents\Codex\2026-06-12\can-you-build-a-website-or\outputs\brickellhouse-portal
```

## Before Uploading

Confirm:

- `.gitignore` is present.
- `.env.example` is present and contains no values.
- `.env`, `.env.local`, and other private credential files are not selected for upload.
- `api/`, `index.html`, JavaScript, CSS, images, and Markdown documentation are included.

## Create the GitHub Repository

### Beginner-Friendly GitHub Website Method

1. Sign in to GitHub.
2. Create a new repository, for example `brickellhouse-portal`.
3. Choose **Private** unless management intentionally approves a public repository.
4. Do not initialize it with a README, `.gitignore`, or license because those files already exist locally.
5. Use GitHub Desktop or Git commands to publish the entire project folder.

### Git Command Method

Open PowerShell in the project folder:

```powershell
git init
git add .
git status
git commit -m "Prepare BrickellHouse portal for Square Sandbox testing"
git branch -M main
git remote add origin https://github.com/YOUR-ACCOUNT/brickellhouse-portal.git
git push -u origin main
```

Before committing, inspect `git status` and verify no `.env` or `.env.local` file is listed.

## Import into Vercel

1. Sign in to Vercel with the GitHub account that owns the repository.
2. Select **Add New > Project**.
3. Import the `brickellhouse-portal` GitHub repository.
4. Keep the project root at the repository root.
5. Use the **Other** framework preset if Vercel does not detect one.
6. No build command is required for this static project.
7. Add the Sandbox variables under **Settings > Environment Variables**:

```text
SQUARE_ENVIRONMENT=sandbox
SQUARE_APPLICATION_ID=
SQUARE_ACCESS_TOKEN=
SQUARE_LOCATION_ID=
SQUARE_API_VERSION=2026-05-20
PROCESSING_FEE_PERCENT=3
```

8. Apply them to **Preview** for testing.
9. Deploy a preview.
10. Open the preview URL and follow `SQUARE_SETUP.md`.

Vercel automatically deploys connected Git branches. Non-production branches receive preview deployments by default.

## Local Vercel Test

From the project root:

```powershell
npx vercel dev --listen 4173
```

This runs both static files and the functions in `api/`.

## Important Limitations

- Do not add production Square credentials.
- Do not change `SQUARE_ENVIRONMENT` from `sandbox`.
- Do not treat a Vercel preview as production-ready.
- Orders are still stored in browser `localStorage`.
- Management authentication and Supabase persistence are still required before production.
