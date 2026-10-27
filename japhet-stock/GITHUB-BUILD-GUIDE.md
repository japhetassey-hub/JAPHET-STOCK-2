# Get your setup.exe using GitHub (free, nothing to install)

1. Go to https://github.com and create a free account (or sign in).
2. Click the "+" at the top right > "New repository". Name it `japhet-stock`, keep it **Private**, click "Create repository".
3. On the new repository page click "uploading an existing file".
4. Open the extracted `japhet-stock` folder on your computer. Select EVERYTHING inside it
   (including the `.github` folder) and drag it into the GitHub page. Wait for the upload, then click "Commit changes".
   - If the `.github` folder did not upload: click "Add file" > "Create new file", type
     `.github/workflows/build-windows.yml` as the name, paste the contents of that file from your folder, and commit.
5. Click the **Actions** tab. If asked, click "I understand my workflows, go ahead and enable them".
6. Click "Build Windows installer" on the left, then "Run workflow" > "Run workflow". (It also starts by itself after step 4.)
7. Wait about 5-8 minutes until you see a green tick.
8. Click the finished run, scroll to **Artifacts**, and download `Japhet-Stock-Management-System-Setup` (a zip).
   Unzip it: inside is `Japhet-Stock-Management-System-Setup-0.2.0.exe`.
9. Double-click the .exe to install. Windows may show "Windows protected your PC" because the installer is not
   code-signed: click "More info" > "Run anyway".

If the run shows a red cross, open it, copy the error text, and send it to Claude to fix.
