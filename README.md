# Sale Smart

Compare your Altadena property sales Google Sheet export against a fresh Redfin CSV download.

## GitHub Pages

1. Go to **Settings -> Pages**
2. Set **Source** to **Deploy from a branch**
3. Branch: **main**, folder: **/docs**
4. Save and wait a minute, then refresh your site

## Update the live site

After code changes:

```bash
npm run build
git add docs
git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" -m "Rebuild site"
git push
```

## Local use

Double-click `start-desktop.bat`, or run `npm run desktop`.
