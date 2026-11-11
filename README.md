# The Ridge @ Team Ranch

A scroll-driven "property film" website for The Ridge @ Team Ranch, a restored log-home farm stay in Waterloo, Ontario, a short drive from St. Jacobs.

As you scroll, the camera moves through the property: a daytime drone arrival, then the dining area, kitchen, living room, bathroom and loft bedroom, then dusk outside, the logo, and the booking call. Nothing plays on its own; the scroll position picks the frame.

**Live site:** https://the-ridge-team-ranch.vercel.app

**Book a stay:** [The Ridge @ Team Ranch on Airbnb](https://www.airbnb.ca/rooms/1739515069661922522?locale=en)

Built by Greg Hahn AI Consulting, Guelph, Ontario.

## Run it locally

The site is plain static HTML, CSS and JavaScript with no build step. Serve the `site` folder with any static server:

```bash
python -m http.server 4173 --directory site
```

Then open http://localhost:4173.

To see the still-frame version (the page people get with reduced motion turned on), open http://localhost:4173/?motion=reduce.

## How it works

- **The film:** each clip is a sequence of WebP frames at 12 fps. One fixed `<canvas>` draws whichever frame the scroll position asks for, using GSAP ScrollTrigger and Lenis smooth scrolling.
- **Scenes:** each `<section class="scene">` in `index.html` has a `--u` value that sets its scroll length in screen heights. The clip order, beat weights and transitions are in the `SCENES` array at the top of `js/film.js`.
- **Transitions:**
  - Clips that share a frame are joined with a short overlap.
  - Room changes use a light bloom from a door or window.
  - The bedroom fire turns into the porch lights through a warm glow.
- **Captions:** real HTML text, faded in and out by scroll. `data-in` and `data-out` on each caption are fractions of its scene's scroll length.
- **Mobile:** portrait frames are cropped from the same footage around a focal point that follows each clip, so phones get their own framing without separate footage.
- **Loading:**
  - The first and last frame of every clip load first, so jumping to any scene lands on the right picture.
  - The current and next clips then load in full, and later clips load sparsely ahead of time.
  - Frame blending eases off as scrolling slows, so a parked frame is always sharp.
- **Fallback:** reduced motion, Save-Data, 2G connections or no canvas support get a still-frame page with the same copy. An inline script in the `<head>` decides this before first paint.

## Folder map

| Path | What it is |
|---|---|
| `site/index.html` | The page: copy, SEO meta, Open Graph and JSON-LD structured data |
| `site/css/styles.css` | All styles. The default is the still-frame page; `html.cine` switches on the film |
| `site/js/film.js` | The scroll engine: canvas frame scrub, transitions, captions, loading |
| `site/js/manifest.js` | Generated frame counts and focal points. Do not edit by hand |
| `site/media/frames/d/` | Desktop (16:9) frame sequences |
| `site/media/frames/m/` | Mobile (portrait) frame sequences |
| `site/media/stills/` | Key stills for the still-frame page and the closing screens |
| `site/vendor/` | GSAP 3.15.1, ScrollTrigger and Lenis 1.3.27, self-hosted |
| `site/fonts/` | Cormorant Garamond and Jost, self-hosted variable fonts |
| `tools/build_media.py` | Builds every file in `site/media` and `site/js/manifest.js` from the master clips |

## Rebuilding the media

`tools/build_media.py` turns the master video clips into the frame sequences, stills, Open Graph image and manifest. The masters and the original photos are not in this repository, so the script only runs from the full project folder, which has `footage/masters/` and `footage/start-frames/` beside `site/`.

```bash
python tools/build_media.py
```

It needs ffmpeg on the PATH and Python with Pillow. To rebuild only some clips, set `ONLY` first, for example `ONLY=kitchen,night python tools/build_media.py frames`. Clip names are `arrival`, `hall`, `tokitchen`, `kitchen`, `toliving`, `living`, `bath`, `bed` and `night`.

## About the footage

The film was generated with Higgsfield (Seedance 2.5), using the owner's own photos of the property as the start and end frame of each clip. The camera moves between real photos, so a few in-between moments are the model's interpretation rather than exact views of the house. The photos on the Airbnb listing are the reference for what the property looks like.

## Accessibility

- One `h1` and a logical heading order. All copy is real text, not part of the video.
- A skip link and visible focus rings on every link and button.
- Caption text over footage was measured at 8.2:1 contrast or better.
- `prefers-reduced-motion` gets the still-frame page with the same content.

## Hosting

The site is on Vercel. `vercel.json` serves `site/` as-is with no build step, caches `media/` for 30 days and `fonts/` and `vendor/` for a year. `.vercelignore` limits the upload to `site/` and `vercel.json`.

The canonical link, `og:url`, `og:image` and the JSON-LD `url` and `image` in `index.html` all use https://the-ridge-team-ranch.vercel.app. Update all five if the site moves to a custom domain.

Still to do:

- Test on real phones and with the operating system's reduced-motion setting. Both have only been emulated in a desktop browser so far.

Page weight is about 38 MB of desktop frames or 17 MB of mobile frames, loaded progressively as you scroll.

## Rights

The photos, footage, frames, logo and copy belong to The Ridge @ Team Ranch and are not licensed for reuse. GSAP, Lenis and the fonts are used under their own licences: the GSAP standard licence, the MIT licence and the SIL Open Font License.
