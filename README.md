EverScale YT Automation Tool

This service watches one Google Drive folder every 5 minutes. When it finds a video file that is not listed in `uploaded.txt`, it asks Gemini for a YouTube title and description, downloads the video to `/tmp`, uploads it to YouTube as public, records the Drive file ID, and deletes the temporary file.

Drive and YouTube can use different Google accounts. The script stores separate OAuth tokens:

- `token-drive.json` for the Google account that owns or can read the Drive folder.
- `token-youtube.json` for the Google account that owns the YouTube channel.

## Setup

1. Enable these APIs in the same Google Cloud project:
   - Google Drive API
   - YouTube Data API v3
2. On the OAuth consent screen, add both Google accounts as test users if the app is still in Testing mode.
3. Create an OAuth 2.0 Desktop app client and save it here as `credentials.json`.
4. Create a Gemini API key.
5. Install dependencies:

```bash
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

6. Create the environment file:

```bash
cp nashik-pg-uploader.env.example nashik-pg-uploader.env
nano nashik-pg-uploader.env
```

Add all Gemini keys as numbered environment variables. The uploader rotates them once per new video and tries the next key if one fails:

```bash
GEMINI_API_KEY=your_first_key
GEMINI_API_KEY_2=your_second_key
GEMINI_API_KEY_3=your_third_key
```

If you have separate OAuth JSON files for Drive and YouTube, set these paths in `nashik-pg-uploader.env`:

```bash
DRIVE_CREDENTIALS_FILE="/home/anonsid/project/YOUTUBE AUTOMATION/credentials-drive.json"
YOUTUBE_CREDENTIALS_FILE="/home/anonsid/project/YOUTUBE AUTOMATION/credentials-youtube.json"
```

7. Authorize the Drive account from the project directory. In the browser, choose the Google account that owns or can read the Drive folder:

```bash
venv/bin/python drive_to_youtube_uploader.py --env-file nashik-pg-uploader.env authorize-drive
```

8. Authorize the YouTube account. In the browser, choose the Google account that owns the YouTube channel:

```bash
venv/bin/python drive_to_youtube_uploader.py --env-file nashik-pg-uploader.env authorize-youtube
```

If your browser keeps picking the wrong account, use an incognito window or a separate browser profile. You can also run with `--no-browser` and paste the shown URL into the browser profile you want.

9. Test one polling pass:

```bash
venv/bin/python drive_to_youtube_uploader.py --env-file nashik-pg-uploader.env once
```

10. Install the systemd service:

```bash
sudo cp nashik-pg-uploader.service /etc/systemd/system/
sudo cp nashik-pg-telegram-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nashik-pg-uploader.service
sudo systemctl enable --now nashik-pg-telegram-bot.service
```

## Operations

Start the local monitoring dashboard:

```bash
venv/bin/python dashboard.py --env-file nashik-pg-uploader.env
```

Then open:

```text
http://127.0.0.1:5050
```

The dashboard shows token status, service/process state, last poll summary,
upload history, recent logs, configuration, and a manual "Run Once" button.

Start the BankaiFTP Telegram bot:

```bash
venv/bin/python telegram_bot.py --env-file nashik-pg-uploader.env
```

For always-on Telegram polling, run it through systemd:

```bash
sudo systemctl status nashik-pg-telegram-bot.service
sudo journalctl -u nashik-pg-telegram-bot.service -f
```

Telegram commands:

```text
/status
/uploads
/logs
/run
```

Check logs:

```bash
journalctl -u nashik-pg-uploader.service -f
journalctl -u nashik-pg-telegram-bot.service -f
```

Restart after editing config:

```bash
sudo systemctl restart nashik-pg-uploader.service
```

OAuth tokens are stored in `token-drive.json` and `token-youtube.json`. Keep `credentials.json`, both token files, and `nashik-pg-uploader.env` private.

Note: The script sets `privacyStatus` to `public`, but YouTube can force uploads from some unverified API projects to private until the API project passes Google's audit requirements.
