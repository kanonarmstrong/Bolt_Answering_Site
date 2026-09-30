/* Home hero 3D phone (AFMBP-1957). The same procedural phone as How It Works
   (three-phone.js: body, materials, lights, reflections — PHONE_LOOK), stood
   upright, with its display reshaped to the app screens: 402:874 points
   (Figma frames 1206x2622 @3x). The pose matches the previous flat hero image
   (assets/hero-phone.png), fitted by silhouette overlap in the same box.

   The screen is real DOM laid onto the display with a perspective (matrix3d)
   transform computed from the projected display corners. Five app screens
   (Figma 2648:1483 Home, 1371 Calls, 1200 Call detail, 1102 Schedule, 1266
   Customers) swipe on a loop; each shows for 2s — 0.5s settle, a 1s on-screen
   animation, 0.5s hold — then swipes (0.45s) to the next. The status bar and
   Dynamic Island stay fixed above the sliding screens, as on a real phone.
   Every frame is a pure function of loop time, so any moment can be rendered
   exactly (?heroqa=1 -> window.__heroPhoneQA.seek(t)).

   Progressive: the hero <img> stays the first paint (LCP) and the fallback;
   the 3D phone fades in over it once its first frame and the Home screen are
   ready. No WebGL -> the image simply stays. Reduced motion -> Home, still. */

import { THREE, clamp, buildPhone, createRenderer, PHONE_LOOK, faceAspectForScreen } from "./three-phone.js?v=2"

;(function () {
    if (typeof window === "undefined" || typeof document === "undefined") return
    var media = document.querySelector(".hero__media")
    var img = media && media.querySelector(":scope > img")
    if (!media || !img) return

    // App screen size in points (Figma frames are 1206x2622 = 3x).
    var SCREEN_W = 402
    var SCREEN_H = 874

    var CFG = Object.assign({}, PHONE_LOOK, {
        screenAspect: SCREEN_H / SCREEN_W,
        fov: 26,
    })
    // Body sized so the display is exactly 874:402 with an even bezel.
    CFG.faceAspect = faceAspectForScreen(PHONE_LOOK, CFG.screenAspect)

    // Pose in the hero image's box: rx/ry/rz in degrees on the upright phone,
    // dist = camera distance, tx/ty = offset in body units (the upright body
    // is 10 units tall). Fitted to the previous flat hero image
    // (assets/hero-phone.png) by maximising silhouette overlap in the same box:
    // IoU 0.988 (?heroqa=1 -> __heroPhoneQA.iou).
    var POSE = { rx: 2, ry: 5.188, rz: -16.656, dist: 24.102, tx: 0.003, ty: 0 }

    // ---------- the loop (seconds) ----------
    var DWELL = 2.0 // each screen shows for 2s...
    var ANIM_AT = 0.5 // ...its animation starts 0.5s in
    var ANIM_LEN = 1.0 // ...runs 1s, then 0.5s hold
    var SWIPE = 0.45 // ...then it swipes to the next
    var SEG = DWELL + SWIPE
    var N = 5
    var LOOP = N * SEG

    var qa = /[?&]heroqa=1(&|$)/.test(window.location.search)
    var reduce =
        window.matchMedia && window.matchMedia("(prefers-reduced-motion:reduce)").matches

    // ---------- helpers ----------
    var A = "assets/hero-phone/"
    var V = "?v=1"
    function el(cls, parent, box) {
        var e = document.createElement("div")
        e.className = cls
        if (box) {
            e.style.left = box.x + "px"
            e.style.top = box.y + "px"
            if (box.w != null) e.style.width = box.w + "px"
            if (box.h != null) e.style.height = box.h + "px"
        }
        if (parent) parent.appendChild(e)
        return e
    }
    function bg(e, file) {
        e.style.backgroundImage = "url(" + A + file + V + ")"
        return e
    }
    function lerp(a, b, t) {
        return a + (b - a) * t
    }
    function unit(t) {
        return t < 0 ? 0 : t > 1 ? 1 : t
    }
    function easeInOutCubic(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    }
    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3)
    }
    function easeOutBack(t, s) {
        var c = s + 1
        return 1 + c * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2)
    }

    // ---------- DOM ----------
    var wrap = document.createElement("div")
    wrap.className = "heroPhone"
    wrap.setAttribute("aria-hidden", "true")
    var canvas = document.createElement("canvas")
    canvas.className = "heroPhone__canvas"
    var screen = document.createElement("div")
    screen.className = "heroPhone__screen"
    wrap.appendChild(canvas)
    wrap.appendChild(screen)
    media.appendChild(wrap)

    var files = [[], [], [], [], []] // images each slide needs before it may show
    var slides = []
    function slide(i, base) {
        var s = bg(el("hp-slide", screen), base)
        files[i].push(base)
        slides[i] = s
        return s
    }
    function layer(i, parent, box, file) {
        var e = el("hp-layer", parent, box)
        if (file) {
            bg(e, file)
            files[i].push(file)
        }
        return e
    }

    // 1 · Home (2648:1483)
    var sHome = slide(0, "s1-home.webp")
    var DECK = { y: 166.33, h: 167.67, cardX: 33, cardW: 330, gap: 8, radius: 14.5 }
    var DECK_CARDS = ["card-garage.webp", "card-renovation.webp", "card-room.webp", "card-remodel.webp"]
    var deck = el("hp-deck", sHome, { x: 0, y: DECK.y, w: SCREEN_W, h: DECK.h })
    var cards = DECK_CARDS.map(function (f) {
        var c = layer(0, deck, { x: DECK.cardX, y: 0, w: DECK.cardW, h: DECK.h }, f)
        c.className = "hp-layer hp-card"
        c.style.borderRadius = DECK.radius + "px"
        return c
    })
    var chartClip = el("hp-clip", sHome, { x: 55.333, y: 468.333, w: 290.333, h: 85.667 })
    layer(0, chartClip, { x: 0, y: 0, w: 290.333, h: 85.667 }, "home-chart.webp")
    function stat(box, from, to, pctText) {
        var count = el("hp-count", sHome, { x: box.count.x, y: box.count.y, w: box.count.w })
        var chip = el("hp-chip", sHome, { x: box.icon.x, y: box.icon.y - 1, w: 80, h: box.icon.h + 2 })
        var icon = el("hp-chip__icon", chip, {
            x: 0,
            y: 1 - 0.0412 * box.icon.h,
            w: box.icon.w,
            h: box.icon.h * 1.0824,
        })
        bg(icon, "chip-up.svg")
        files[0].push("chip-up.svg")
        var pct = el("hp-pct", chip, { x: box.pct.x - box.icon.x, y: box.pct.y - box.icon.y + 1, h: box.pct.h })
        pct.textContent = pctText
        return { count: count, chip: chip, from: from, to: to, last: null }
    }
    // Storyboard values (owner): Jobs 2 -> 7 (+95.1%), Leads 1 -> 23 (+98.3%).
    var jobs = stat(
        { count: { x: 140.502, y: 355.742, w: 51.569 }, icon: { x: 53.508, y: 384.733, w: 12.439, h: 11.912 }, pct: { x: 78.675, y: 388.46, h: 8.082 } },
        2, 7, "+95.1%"
    )
    var leads = stat(
        { count: { x: 311.982, y: 356.05, w: 45.044 }, icon: { x: 220.964, y: 384.63, w: 12.423, h: 11.912 }, pct: { x: 246.131, y: 388.357, h: 8.077 } },
        1, 23, "+98.3%"
    )

    // 2 · Calls (2648:1371)
    var sCalls = slide(1, "s2-calls.webp")
    var list = el("hp-clip", sCalls, { x: 0, y: 272.667, w: 384, h: 526.667 })
    var callsRest = layer(1, list, { x: 0, y: 86, w: 384, h: 440.667 }, "calls-rest.webp")
    var callsRow = layer(1, list, { x: 0, y: 0, w: 384, h: 86 }, "calls-row.webp")

    // 3 · Call detail (2648:1200)
    var sDetail = slide(2, "s3-detail.webp")
    var urgent = layer(2, sDetail, { x: 310.667, y: 119.333, w: 61, h: 26.333 }, "detail-urgent.webp")

    // 4 · Schedule (2648:1102)
    var sSched = slide(3, "s4-schedule.webp")
    var block = layer(3, sSched, { x: 89.333, y: 468.667, w: 287, h: 42.667 }, "sched-block.png")

    // 5 · Customers (2648:1266): no animation
    slide(4, "s5-customers.webp")

    // Fixed status bar + Dynamic Island, above the sliding screens.
    bg(el("hp-status", screen, { x: 0, y: 0, w: SCREEN_W, h: 54 }), "status.png")
    files[0].push("status.png")

    // ---------- per-screen animation at progress u (0 = start state, 1 = end) ----------
    function setCount(s, u) {
        var v = Math.round(lerp(s.from, s.to, easeOutCubic(u)))
        if (v !== s.last) {
            s.count.textContent = String(v)
            s.last = v
        }
    }
    function pop(e, p) {
        e.style.opacity = String(unit(p * 3))
        e.style.transform = "scale(" + (p <= 0 ? 0 : easeOutBack(p, 2.2)) + ")"
    }
    var deckMid = DECK.cardX + DECK.cardW / 2
    function deckAt(pos) {
        // The app's carousel (bolt-web HomeScreen useCarouselScale): distance d
        // from the centre, height x (1 - 0.16d), opacity (1 - 0.35d).
        for (var i = 0; i < cards.length; i++) {
            var x = (i - pos) * (DECK.cardW + DECK.gap)
            var d = Math.min(1, Math.abs(DECK.cardX + x + DECK.cardW / 2 - deckMid) / (SCREEN_W / 2))
            cards[i].style.transform = "translateX(" + x + "px) scaleY(" + (1 - d * 0.16) + ")"
            cards[i].style.opacity = String(1 - d * 0.35)
        }
    }
    var ANIMS = [
        function home(u, still) {
            setCount(jobs, u)
            setCount(leads, u)
            pop(jobs.chip, unit((u - 0.1) / 0.35))
            pop(leads.chip, unit((u - 0.18) / 0.35))
            var e = easeInOutCubic(unit(u))
            chartClip.style.clipPath = "inset(0 " + (1 - e) * 100 + "% 0 0)"
            deckAt(still ? 1 : 1 + easeInOutCubic(unit((u - 0.2) / 0.6)))
        },
        function calls(u) {
            var e1 = easeOutCubic(unit(u / 0.55))
            callsRest.style.transform = "translateY(" + -86 * (1 - e1) + "px)"
            var e2 = easeOutCubic(unit((u - 0.12) / 0.6))
            callsRow.style.transform = "translateX(" + 1.1 * 384 * (1 - e2) + "px)"
            callsRow.style.opacity = String(e2)
        },
        function detail(u) {
            var p = unit(u / 0.35)
            var s = p <= 0 ? 0 : easeOutBack(p, 2.4)
            var q = unit((u - 0.35) / 0.65)
            if (q > 0) s = 1 + 0.08 * Math.pow(Math.sin(Math.PI * 2 * q), 2) // two pulses
            urgent.style.transform = "scale(" + s + ")"
            urgent.style.opacity = String(unit(p * 4))
        },
        function schedule(u) {
            var p = unit(u / 0.7)
            block.style.transform = "translateY(" + -26 * (1 - easeOutBack(p, 1.6)) + "px)"
            block.style.opacity = String(unit(p * 4))
        },
        function customers() {},
    ]

    // ---------- the screen at loop time t ----------
    var slideState = []
    function show(i, x) {
        var st = x === null ? "hidden" : "translateX(" + x + "px)"
        if (slideState[i] === st) return
        slideState[i] = st
        // display:none, not visibility: a hidden screen then holds no layers or
        // raster memory at all (several full-size layers under the perspective
        // transform starved the compositor and dropped tiles).
        if (x === null) {
            slides[i].style.display = "none"
        } else {
            slides[i].style.display = "block"
            slides[i].style.transform = "translateX(" + x + "px)"
        }
    }
    function renderAt(t) {
        t = ((t % LOOP) + LOOP) % LOOP
        var cur = Math.floor(t / SEG) % N
        var local = t - cur * SEG
        var nxt = (cur + 1) % N
        var p = local < DWELL ? 0 : easeInOutCubic(unit((local - DWELL) / SWIPE))
        for (var i = 0; i < N; i++) {
            if (i === cur) show(i, -p * SCREEN_W)
            else if (i === nxt && p > 0) show(i, (1 - p) * SCREEN_W)
            else show(i, null)
        }
        ANIMS[cur](unit((local - ANIM_AT) / ANIM_LEN))
        if (p > 0) ANIMS[nxt](0) // a screen swiping in shows its start state
    }
    function renderStill() {
        // Reduced motion: Home, finished, with the node's own card centred.
        for (var i = 0; i < N; i++) show(i, i === 0 ? 0 : null)
        ANIMS[0](1, true)
    }

    // ---------- clock: runs only while the hero is on screen ----------
    var loopT = 0
    var lastTs = 0
    var raf = 0
    var inView = true
    var ready = [false, false, false, false, false]
    var started = false
    var paused = false
    function tick(ts) {
        raf = 0
        if (!started || paused || !inView || document.hidden) {
            lastTs = 0
            return
        }
        var dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0
        lastTs = ts
        var cur = Math.floor((((loopT % LOOP) + LOOP) % LOOP) / SEG) % N
        var local = (((loopT % LOOP) + LOOP) % LOOP) - cur * SEG
        if (local + dt >= DWELL && !ready[(cur + 1) % N]) {
            // The next screen hasn't loaded: hold this one, finished, and stop
            // the clock until load() wakes it (a screen that fails never does).
            loopT = loopT - local + DWELL - 1e-6
            renderAt(loopT)
            lastTs = 0
            return
        }
        loopT = (loopT + dt) % LOOP
        renderAt(loopT)
        raf = window.requestAnimationFrame(tick)
    }
    function wake() {
        if (!raf && started && !paused && inView && !document.hidden)
            raf = window.requestAnimationFrame(tick)
    }
    function start() {
        // Reduced motion: the still frame only; the clock never starts.
        if (reduce) return renderStill()
        if (started) return
        started = true
        loopT = 0
        renderAt(0)
        wake()
    }

    // ---------- Three.js ----------
    var scene = new THREE.Scene()
    var camera = new THREE.PerspectiveCamera(CFG.fov, 1, 0.1, 400)
    var poseGroup = new THREE.Group()
    var phone = new THREE.Group()
    phone.rotation.z = Math.PI / 2 // landscape-modelled body stood upright: island on top
    poseGroup.add(phone)
    scene.add(poseGroup)

    var renderer = null
    var geomCtx = null
    var disposed = false
    var frameReady = false
    var resizeObserver = null
    var rad = THREE.MathUtils.degToRad
    var corner = new THREE.Vector3()

    function syncBox() {
        // The phone occupies exactly the hero image's box (same size + place).
        wrap.style.left = img.offsetLeft + "px"
        wrap.style.top = img.offsetTop + "px"
        wrap.style.width = img.offsetWidth + "px"
        wrap.style.height = img.offsetHeight + "px"
    }

    function applyPose() {
        poseGroup.rotation.set(rad(POSE.rx), rad(POSE.ry), rad(POSE.rz))
        poseGroup.position.set(POSE.tx, POSE.ty, 0)
        camera.position.set(0, 0, POSE.dist)
        camera.lookAt(0, 0, 0)
    }

    // Perspective transform taking the w x h element onto the quad q (TL, TR,
    // BR, BL in wrapper px). Heckbert's square->quad mapping, pre-scaled to
    // the element and written column-major for CSS matrix3d.
    function quadMatrix3d(w, h, q) {
        var x0 = q[0][0], y0 = q[0][1], x1 = q[1][0], y1 = q[1][1]
        var x2 = q[2][0], y2 = q[2][1], x3 = q[3][0], y3 = q[3][1]
        var dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3
        var dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3
        var det = dx1 * dy2 - dx2 * dy1
        var g = (sx * dy2 - dx2 * sy) / det
        var hh = (dx1 * sy - sx * dy1) / det
        var a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3, c = x0
        var d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3, f = y0
        return (
            "matrix3d(" +
            [a / w, d / w, 0, g / w, b / h, e / h, 0, hh / h, 0, 0, 1, 0, c, f, 0, 1].join(",") +
            ")"
        )
    }

    function projectLocal(x, y, z, w, h) {
        corner.set(x, y, z).applyMatrix4(phone.matrixWorld).project(camera)
        return [((corner.x + 1) / 2) * w, ((1 - corner.y) / 2) * h]
    }

    function placeScreen(w, h) {
        var s = geomCtx.screenLocal
        // Upright (+90deg about Z): local +X is up, local +Y is left.
        var q = [
            projectLocal(s.x1, s.y1, s.z, w, h), // top-left
            projectLocal(s.x1, s.y0, s.z, w, h), // top-right
            projectLocal(s.x0, s.y0, s.z, w, h), // bottom-right
            projectLocal(s.x0, s.y1, s.z, w, h), // bottom-left
        ]
        screen.style.transform = quadMatrix3d(SCREEN_W, SCREEN_H, q)
        var shortSide = Math.min(s.x1 - s.x0, s.y1 - s.y0)
        screen.style.borderRadius = (geomCtx.screenRadius / shortSide) * SCREEN_W + "px"
    }

    function render() {
        if (disposed || !renderer || !geomCtx) return
        syncBox()
        var w = wrap.clientWidth,
            h = wrap.clientHeight
        if (!w || !h) return
        renderer.setPixelRatio(clamp(window.devicePixelRatio || 1, 1, 2))
        renderer.setSize(w, h, false)
        camera.aspect = w / h
        camera.fov = CFG.fov
        camera.updateProjectionMatrix()
        applyPose()
        scene.updateMatrixWorld(true)
        renderer.render(scene, camera)
        placeScreen(w, h)
        if (!frameReady) {
            frameReady = true
            maybeShow()
        }
    }

    function maybeShow() {
        if (!frameReady || !ready[0] || !imgPainted) return
        media.classList.add("hero__media--3d")
        start()
    }

    function init() {
        try {
            renderer = createRenderer(canvas)
        } catch (e) {
            return // no WebGL: the hero image stays
        }
        var built = buildPhone(
            scene,
            phone,
            renderer,
            CFG,
            function () {
                return disposed
            },
            render
        )
        geomCtx = built.geomCtx
        renderStill()
        render()
        window.addEventListener("resize", render)
        if ("ResizeObserver" in window) {
            resizeObserver = new ResizeObserver(render)
            resizeObserver.observe(img)
        }
    }

    // Preload + decode each screen's images; Home first, the rest right after.
    // A screen counts as ready only when every one of its files has loaded; a
    // screen with a failed file never shows (Home failing keeps the hero image).
    function fetchImage(src) {
        return new Promise(function (resolve, reject) {
            var im = new Image()
            im.onload = function () {
                // Decode ahead of paint where supported; a decode error after
                // a good load isn't fatal (the browser decodes at paint).
                if (im.decode) im.decode().then(resolve, resolve)
                else resolve()
            }
            im.onerror = reject
            im.src = src
        })
    }
    function load(i) {
        var list = files[i].filter(function (f, k, a) {
            return a.indexOf(f) === k
        })
        return Promise.all(
            list.map(function (f) {
                return fetchImage(A + f + V)
            })
        ).then(
            function () {
                ready[i] = true
                if (i === 0) maybeShow()
                wake()
                return true
            },
            function () {
                return false
            }
        )
    }
    // The hero image stays the page's largest paint (LCP): the screens only
    // start downloading once it has loaded, and the 3D phone replaces it only
    // after it has painted — so neither competes with it or hides it first.
    var imgPainted = false
    function afterImage() {
        window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () {
                imgPainted = true
                load(0).then(function (ok) {
                    // Reduced motion only ever shows Home.
                    if (ok && !reduce) for (var i = 1; i < N; i++) load(i)
                })
            })
        })
    }
    if (img.complete && img.naturalWidth) afterImage()
    else img.addEventListener("load", afterImage, { once: true })

    if ("IntersectionObserver" in window) {
        new IntersectionObserver(
            function (entries) {
                inView = entries.some(function (e) {
                    return e.isIntersecting
                })
                wake()
            },
            { threshold: 0 }
        ).observe(media)
    }
    document.addEventListener("visibilitychange", wake)

    if (qa) {
        window.__heroPhoneQA = {
            CFG: CFG,
            POSE: POSE,
            LOOP: LOOP,
            geom: function () {
                return geomCtx
            },
            ready: function () {
                return ready.slice()
            },
            setPose: function (p) {
                Object.assign(POSE, p)
                render()
                return POSE
            },
            // Freeze the loop at time t (seconds) and render that exact frame.
            seek: function (t) {
                paused = true
                loopT = t
                renderAt(t)
                return t
            },
            play: function () {
                paused = false
                wake()
            },
            time: function () {
                return loopT
            },
            // Silhouette overlap with the hero image in the same box, at mask
            // width mw: renders, then reads the canvas in the same task.
            iou: function (mw) {
                render()
                var w = wrap.clientWidth,
                    h = wrap.clientHeight
                var mh = Math.round((mw * h) / w)
                var cv = document.createElement("canvas")
                cv.width = mw
                cv.height = mh
                var cx = cv.getContext("2d", { willReadFrequently: true })
                cx.drawImage(canvas, 0, 0, mw, mh)
                var a = cx.getImageData(0, 0, mw, mh).data
                cx.clearRect(0, 0, mw, mh)
                cx.drawImage(img, 0, 0, mw, mh)
                var b = cx.getImageData(0, 0, mw, mh).data
                var inter = 0,
                    uni = 0
                for (var i = 3; i < a.length; i += 4) {
                    var pa = a[i] > 128,
                        pb = b[i] > 128
                    if (pa && pb) inter++
                    if (pa || pb) uni++
                }
                return uni ? inter / uni : 0
            },
        }
    }

    init()

    window.addEventListener(
        "pagehide",
        function () {
            disposed = true
            if (raf) window.cancelAnimationFrame(raf)
            if (resizeObserver) resizeObserver.disconnect()
            if (renderer) {
                renderer.dispose()
                renderer.forceContextLoss && renderer.forceContextLoss()
            }
        },
        { once: true }
    )
})()
