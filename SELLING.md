# Selling the Founding DJ pass

Setcraft is free to use. The **Founding DJ pass** is a one-time purchase that unlocks full export (every track,
every cue, back into rekordbox, Traktor and djay Pro). Without it, an export holds up to 3 tracks, enough for a DJ
to check it works with their own software before buying.

There is no server: buyers pay through a checkout link, you send them a key, and the app checks the key offline.
**Until you finish steps 1–3, sales are off and everything stays free**, so nothing changes while you set up.

## 1. Create your signing key (once)

On your computer, in the `dj-app` folder:

```
npm run license -- setup
```

This creates your private signing key in `~/.setcraft/founding-signing-key.pem` and writes the matching public key
into `src/config.ts`.

- **Back up that `.pem` file** (a password manager is ideal). Without it you can't issue keys this app accepts.
- **Never share it or commit it.** It lives outside the repo on purpose; `*.pem` is also git-ignored.
- The public key in `src/config.ts` is meant to be public.

## 2. Make a checkout link

Pick one:

- **Stripe Payment Link**: quickest to set up. In the Stripe dashboard, add a product ("Setcraft Founding DJ
  pass"), set a one-time price, and create a Payment Link. Add a custom field for the DJ name, and set the
  confirmation message to something like "Thanks! Your key arrives by email within 24 hours." With Stripe you are
  the seller, so sales tax / VAT is your responsibility.
- **Lemon Squeezy** (or Paddle): acts as the merchant of record and handles sales tax and VAT for you, for a
  higher fee. Create a product with a one-time price and use its checkout link.

Check each provider's current fees and terms before choosing.

## 3. Fill in `src/config.ts`

```ts
price: '$49',                     // what the pass shows
checkoutUrl: 'https://…',         // your checkout link from step 2
contact: 'you@example.com',       // shown to founding DJs
seats: 100,                       // "limited to the first 100 DJs"
freeExportTracks: 3,              // tracks per export without a pass
```

Commit and push `src/config.ts`. Sales are now on: the ★ Founding DJ button shows the checkout, and exports over
3 tracks ask for a pass.

## 4. Put Setcraft online

Other DJs need a public **https** address (browsers only check keys on https pages or localhost). `npm run build`
makes a static site in `dist/` that any static host can serve: Netlify, Vercel, Cloudflare Pages or GitHub Pages.

## 5. Send each buyer their key

When a sale comes in:

```
npm run license -- new "DJ Name" buyer@email.com
```

It prints the key and a ready-to-send email (with their Founding DJ number, counted up automatically). Paste it
into a reply to the buyer. `npm run license -- list` shows everyone you've issued a key to (kept in
`~/.setcraft/founding-keys-issued.json`).

Issue yourself one first to see the whole flow: ★ Founding DJ → *I have a key* → paste.

## Good to know

- **The check runs in the browser.** Someone determined could patch it out, or share a key. It keeps honest people
  honest, which is normal for a founding pass; it isn't DRM.
- **Keys can't be revoked** (there's no server to check against). If you refund someone, their key keeps working.
- **One key, any number of browsers.** DJs paste the same key wherever they use Setcraft.
- Later, the "send a key" step can be automated with a small webhook (Stripe or Lemon Squeezy → a function that runs
  the same signing code and emails the key).
