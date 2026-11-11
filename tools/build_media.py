"""Build web media for The Ridge scroll film from the Higgsfield masters.

    python tools/build_media.py            # everything
    python tools/build_media.py frames     # frame sequences only
    python tools/build_media.py video      # MP4 + WebM only
    python tools/build_media.py stills     # stills, OG image, logo, manifest

Outputs go to site/media and site/js/manifest.js.

Desktop frames keep the 16:9 master. Mobile frames are portrait crops of the same
masters: a window 37.5% of the frame wide that follows a focal point set per clip
(FOCUS below), so nothing is generated twice.
"""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTERS = os.path.join(ROOT, "footage", "masters")
PHOTOS = os.path.join(ROOT, "footage", "start-frames")
MEDIA = os.path.join(ROOT, "site", "media")
STEP = 2            # keep every 2nd frame: 24 fps masters -> 12 fps sequences
CROP = 0.375        # mobile window width as a fraction of the frame

# name -> (master file, desktop size, mobile size)
CLIPS = {
    "arrival":   ("c1-arrival.mp4",        (1600, 900), (640, 960)),
    "hall":      ("c2-hall-dining.mp4",    (1280, 720), (480, 720)),
    "tokitchen": ("c3-dining-kitchen.mp4", (1280, 720), (480, 720)),
    "kitchen":   ("c4-kitchen.mp4",        (1280, 720), (480, 720)),
    "toliving":  ("c5-kitchen-living.mp4", (1280, 720), (480, 720)),
    "living":    ("c6-living.mp4",         (1280, 720), (480, 720)),
    "bath":      ("c7-bathroom.mp4",       (1280, 720), (480, 720)),
    "bed":       ("c8-bedroom.mp4",        (1280, 720), (480, 720)),
    "night":     ("c9-night.mp4",          (1600, 900), (640, 960)),
}

# Mobile focal track per clip: (time 0..1, x-centre 0..1 of the 16:9 frame).
# Adjacent clips that share a photo start and end on the same value.
FOCUS = {
    "arrival":   [(0, .46), (.5, .39), (1, .38)],
    "hall":      [(0, .76), (.3, .76), (.5, .34), (.62, .40), (.8, .56), (1, .56)],
    "tokitchen": [(0, .56), (.3, .50), (.5, .50), (.62, .55), (.75, .45), (1, .52)],
    "kitchen":   [(0, .52), (1, .50)],
    "toliving":  [(0, .50), (.3, .72), (.5, .68), (.7, .55), (1, .42)],
    "living":    [(0, .42), (.3, .38), (.45, .48), (.6, .60), (.75, .62), (1, .36)],
    "bath":      [(0, .42), (.6, .50), (.75, .45), (.9, .30), (1, .22)],
    "bed":       [(0, .36), (.35, .36), (.5, .50), (.56, .70), (.64, .60), (.72, .47), (.82, .42), (1, .41)],
    "night":     [(0, .46), (1, .47)],
}

# Points the transitions bloom from, as (x, y) in the 16:9 frame, with the clip and
# the moment (0 start, 1 end) they belong to. Mobile values are derived from FOCUS.
POINTS = {
    "door":       ("arrival", 1, (.37, .53)),   # front door, end of the drone descent
    "hallDoor":   ("hall",    0, (.84, .53)),   # front door seen down the hall
    "livingDoor": ("living",  1, (.43, .52)),   # hallway door
    "bathIn":     ("bath",    0, (.50, .45)),
    "bathWindow": ("bath",    1, (.12, .52)),   # window over the fields
    "bedWindow":  ("bed",     0, (.23, .44)),
    "fire":       ("bed",     1, (.41, .55)),
    "porch":      ("night",   0, (.47, .58)),
}


def run(args):
    subprocess.run(args, check=True)


def probe(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height,nb_frames", "-of", "json", path],
        check=True, capture_output=True, text=True).stdout
    s = json.loads(out)["streams"][0]
    return int(s["width"]), int(s["height"]), int(s["nb_frames"])


def centre_at(track, t):
    for (t0, x0), (t1, x1) in zip(track, track[1:]):
        if t <= t1:
            u = 0 if t1 == t0 else (t - t0) / (t1 - t0)
            u = max(0.0, min(1.0, u))
            return x0 + (x1 - x0) * u * u * (3 - 2 * u)
    return track[-1][1]


def pan_expr(track, n_out, w_src, w_crop):
    """ffmpeg expression for the crop's x: smoothstep between focal keyframes."""
    last = max(1, n_out - 1)
    expr = "%.2f" % ((track[-1][1] - CROP / 2) * w_src)
    for (t0, x0), (t1, x1) in reversed(list(zip(track, track[1:]))):
        a, b = (x0 - CROP / 2) * w_src, (x1 - CROP / 2) * w_src
        u = "clip((n/%d-%.4f)/%.4f\\,0\\,1)" % (last, t0, max(1e-6, t1 - t0))
        seg = "%.2f+(%.2f)*(%s)*(%s)*(3-2*(%s))" % (a, b - a, u, u, u)
        expr = "if(lte(n/%d\\,%.4f)\\,%s\\,%s)" % (last, t1, seg, expr)
    return "clip(%s\\,0\\,%d)" % (expr, w_src - w_crop)


def clean(d):
    if os.path.isdir(d):
        shutil.rmtree(d)
    os.makedirs(d)


ONLY = [s for s in os.environ.get("ONLY", "").split(",") if s]   # e.g. ONLY=bed,night


def frames():
    for name, (src, dsize, msize) in CLIPS.items():
        if ONLY and name not in ONLY:
            continue
        path = os.path.join(MASTERS, src)
        w, h, n = probe(path)
        n_out = (n + STEP - 1) // STEP
        sel = "select='not(mod(n\\,%d))'" % STEP
        sharpen = "" if w > 1280 else ",unsharp=5:5:0.45:5:5:0.0"

        d_dir = os.path.join(MEDIA, "frames", "d", name)
        clean(d_dir)
        run(["ffmpeg", "-v", "error", "-y", "-i", path, "-vf",
             "%s,scale=%d:%d:flags=lanczos%s" % (sel, dsize[0], dsize[1], sharpen),
             "-fps_mode", "vfr", "-c:v", "libwebp", "-quality", "74", "-compression_level", "4",
             os.path.join(d_dir, "%04d.webp")])

        m_dir = os.path.join(MEDIA, "frames", "m", name)
        clean(m_dir)
        w_crop = int(round(w * CROP / 2)) * 2
        x = pan_expr(FOCUS[name], n_out, w, w_crop)
        run(["ffmpeg", "-v", "error", "-y", "-i", path, "-vf",
             "%s,crop=%d:%d:x='%s':y=0,scale=%d:%d:flags=lanczos%s" % (sel, w_crop, h, x, msize[0], msize[1], sharpen),
             "-fps_mode", "vfr", "-c:v", "libwebp", "-quality", "72", "-compression_level", "4",
             os.path.join(m_dir, "%04d.webp")])
        got_d, got_m = len(os.listdir(d_dir)), len(os.listdir(m_dir))
        assert got_d == n_out == got_m, (name, n_out, got_d, got_m)
        print("frames %-10s %3d  d %s  m %s" % (name, n_out, dsize, msize))


def video():
    out = os.path.join(MEDIA, "video")
    os.makedirs(out, exist_ok=True)
    for name, (src, _, _) in CLIPS.items():
        if ONLY and name not in ONLY:
            continue
        path = os.path.join(MASTERS, src)
        run(["ffmpeg", "-v", "error", "-y", "-i", path, "-an", "-c:v", "libx264", "-preset", "slow",
             "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", os.path.join(out, name + ".mp4")])
        run(["ffmpeg", "-v", "error", "-y", "-i", path, "-an", "-c:v", "libsvtav1", "-preset", "6",
             "-crf", "36", "-pix_fmt", "yuv420p", os.path.join(out, name + ".webm")])
        print("video  %-10s mp4 %5.1f MB  webm %5.1f MB" % (
            name, os.path.getsize(os.path.join(out, name + ".mp4")) / 1e6,
            os.path.getsize(os.path.join(out, name + ".webm")) / 1e6))


def webp(src, dst, vf, q=82):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    run(["ffmpeg", "-v", "error", "-y", "-i", src, "-vf", vf, "-frames:v", "1", "-update", "1",
         "-c:v", "libwebp", "-quality", str(q), "-compression_level", "6", dst])


def stills():
    st = os.path.join(MEDIA, "stills")
    hero = os.path.join(MASTERS, CLIPS["arrival"][0])
    night = os.path.join(MASTERS, CLIPS["night"][0])
    w, h, n = probe(hero)

    # Hero poster: frame 0, identical to the first frame of each sequence.
    os.makedirs(os.path.join(st, "d"), exist_ok=True)
    os.makedirs(os.path.join(st, "m"), exist_ok=True)
    shutil.copyfile(os.path.join(MEDIA, "frames", "d", "arrival", "0001.webp"), os.path.join(st, "d", "arrival.webp"))
    shutil.copyfile(os.path.join(MEDIA, "frames", "m", "arrival", "0001.webp"), os.path.join(st, "m", "arrival.webp"))

    # Key stills for the still-frame page: the supplied photos, cropped to 16:9.
    for out, photo in [("dining", "dining-area-1"), ("kitchen", "kitchen-1"), ("living", "living-room-1"),
                       ("bathroom", "bathroom-1"), ("bedroom", "bedroom-1"), ("night", "exterior-night")]:
        webp(os.path.join(PHOTOS, photo + ".jpg"), os.path.join(st, out + ".webp"), "scale=1280:720:flags=lanczos")

    # Final night frame, held behind the logo and the booking section.
    nw, nh, nn = probe(night)
    webp(night, os.path.join(st, "night-end.webp"), "select='eq(n\\,%d)',scale=1600:900:flags=lanczos" % (nn - 1))

    # Open Graph image: a still from the hero clip, 1200 x 630.
    run(["ffmpeg", "-v", "error", "-y", "-i", hero, "-vf",
         "select='eq(n\\,30)',scale=1200:675:flags=lanczos,crop=1200:630:0:22",
         "-frames:v", "1", "-update", "1", "-q:v", "3", os.path.join(MEDIA, "og.jpg")])

    # The logo, byte for byte.
    shutil.copyfile(os.path.join(ROOT, "ridge-images", "ridge-logo.webp"), os.path.join(MEDIA, "ridge-logo.webp"))
    print("stills, og.jpg, logo copied")


def manifest():
    data = {"d": {}, "m": {}, "points": {}}
    for name, (src, dsize, msize) in CLIPS.items():
        if not os.path.isdir(os.path.join(MEDIA, "frames", "d", name)):
            continue
        n = len(os.listdir(os.path.join(MEDIA, "frames", "d", name)))
        data["d"][name] = {"n": n, "w": dsize[0], "h": dsize[1]}
        data["m"][name] = {"n": n, "w": msize[0], "h": msize[1]}
    for key, (clip, when, (x, y)) in POINTS.items():
        c = centre_at(FOCUS[clip], when)
        mx = (x - (c - CROP / 2)) / CROP
        data["points"][key] = {"d": [x, y], "m": [round(max(0.0, min(1.0, mx)), 3), y]}
    path = os.path.join(ROOT, "site", "js", "manifest.js")
    with open(path, "w", encoding="utf-8") as f:
        f.write("/* Generated by tools/build_media.py. Do not edit by hand. */\n")
        f.write("window.RIDGE_MEDIA = " + json.dumps(data, separators=(",", ":")) + ";\n")
    print("manifest written")


if __name__ == "__main__":
    what = sys.argv[1:] or ["frames", "video", "stills"]
    if "frames" in what:
        frames()
    if "video" in what:
        video()
    if "stills" in what:
        stills()
    manifest()
