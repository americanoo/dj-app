# dj-app
dj organizing app for set lists 

## Higgsfield (Seedance 2.5) example

Server-side example using the official `@higgsfield/client` SDK with model
`bytedance/seedance-2.5/text-to-video`.

1. Copy `.env.example` to `.env.local` and set `HF_CREDENTIALS=KEY_ID:KEY_SECRET`
   (`.env.local` is git-ignored). An `HF_CREDENTIALS` environment variable also works.
2. Install and run (makes a billable generation request):

   ```bash
   npm install
   npm start
   ```

The script waits for completion and prints the video URL. It exits non-zero
on failed, moderated (`nsfw`), canceled, or errored requests.
