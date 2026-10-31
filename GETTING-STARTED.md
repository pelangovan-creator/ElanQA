# Getting started with QA Pilot (no technical knowledge needed)

QA Pilot runs on your own computer inside **Docker Desktop**, a free program that runs apps in a sealed box. You install Docker once. After that, you double-click one file to start QA Pilot and use it in your web browser.

You need a Windows 10/11 PC or a Mac with at least 8 GB of memory, about 10 GB of free disk space, and an internet connection for the first start.

## Step 1 – Install Docker Desktop (one time, about 10 minutes)

1. Go to **https://www.docker.com/products/docker-desktop/** and click **Download Docker Desktop**, choosing your system:
   - Windows: *Windows – AMD64*. Most PCs are AMD64; choose ARM64 only for ARM laptops such as some Surface models.
   - Mac: *Apple Silicon* for M1/M2/M3/M4 Macs, or *Intel chip* for older ones. To check, click  **> About This Mac**.
2. Open the downloaded file and follow the installer. Keep the default options. On Windows, restart the PC if it asks you to.
3. Open **Docker Desktop** from the Start menu (Windows) or Applications (Mac). Accept the terms. You can skip signing in.
4. Wait until the bottom-left corner of Docker Desktop shows **Engine running**.

## Step 2 – Download QA Pilot (one time)

1. Go to **https://github.com/pelangovan-creator/ElanQA**.
2. Click the green **<> Code** button, then **Download ZIP**.
3. Unzip it:
   - Windows: right-click the ZIP and choose **Extract All… > Extract**.
   - Mac: double-click the ZIP.

   You now have a folder called **ElanQA-main**. Move it somewhere easy to find, such as your Documents folder.

## Step 3 – Start QA Pilot

Open the **ElanQA-main** folder and double-click:

| Windows | Mac |
|---|---|
| **Start QA Pilot (Windows).bat** | **Start QA Pilot (Mac).command** |

A black window opens and shows the progress.

- **The first start takes 5–15 minutes** while QA Pilot is built. Later starts take less than a minute.
- When it is ready, your browser opens **http://localhost:8080**, and a file called **QA-Pilot-login.txt** shows your email and password. Your password is created just for you.
- Sign in with that email and password. Then click your name at the top right and choose **Change password**.

**If Windows shows "Windows protected your PC":** click **More info > Run anyway**. This is normal for files downloaded from the internet.

**If the Mac says the file "can't be opened" or is from an "unidentified developer":** right-click (or Control-click) the file, choose **Open**, then click **Open** again. You only need to do this the first time. If it still refuses, open the **Terminal** app, type `bash ` (with a space), drag the file into the Terminal window, and press Return.

## Step 4 – Try it with the built-in demo shop

QA Pilot comes with a small practice shop called *ShopEasy*, which contains a few deliberate bugs, for you to test.

1. In the left menu, click **All projects**, then **New project**. Give it a key such as `SHOP` and a name, then create it.
2. Click **Requirements & RTM** and upload the file `apps/demo/docs/demo-srs.md` from your ElanQA-main folder.
3. Click **Test Artefacts**, open the **Test Cases** tab and click **Generate for unmapped requirements**. Then tick **Select all** and click **Approve**.
4. Click **Test Execution**:
   - On the **Environments** tab, add an environment with the URL **`http://demo:4600`**.
   - On the **Scripts** tab, click **Generate / update scripts**.
   - On the **Run** tab, click **▶ Run Test Cases**.
5. Watch the results come in live. Every failed test creates a draft defect with a screenshot. Open **Defects** to review the drafts and confirm them.
6. Open **Reports & Dashboard** and **Test Closure** to see the reports. Each one can be downloaded as PDF, Word or Excel.

To test your own website, use its normal address (for example `https://test.mycompany.com`) as the environment URL.

## Stopping and starting again

- **To stop QA Pilot:** double-click **Stop QA Pilot (Windows).bat** or **Stop QA Pilot (Mac).command**. You can also just quit Docker Desktop.
- **To start again:** open Docker Desktop, then double-click the **Start** file. All your projects and data are still there.

## Good to know

- QA Pilot runs only on your computer. Other people cannot reach it unless it is installed on a server. Ask for help with that when you need it.
- **Do not delete** the hidden `.env` file or the ElanQA-main folder. The `.env` file holds the keys that protect stored passwords. To keep a copy of a project, use **Export full project backup** on its Overview page.
- If something goes wrong, take a screenshot of the black window and share it with whoever supports you.
