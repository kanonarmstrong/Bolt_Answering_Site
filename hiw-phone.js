/* How It Works 3D phone — vanilla ES-module port of the Framer/Three.js
   `PhoneFlip3D` component (procedural chassis, front/back surfaces, Dynamic
   Island, rear camera island + lenses + logo, scroll-driven X-axis flip,
   HTML video overlay projected onto the front face).

   Ports the working component to the static site 1:1, minus the Framer runtime
   (RenderTarget / property controls) and React (hooks -> plain DOM + closures);
   the property-control defaults are inlined as CFG.

   The ONE behavioural addition the brief asks for: a persistent 8deg visual
   tilt applied on the Three.js phone group's Z axis (not CSS, not a wrapper) —
   see PHONE_VISUAL_TILT_DEG below and `group.rotation.set(rot, 0, tiltRad)` in
   the loop. Reduced-motion holds the phone static (front-facing) at that tilt.

   Mounts into `.hiwphone` in the How It Works (#band) section. Desktop lets the
   phone overflow into the neighbouring sections; mobile keeps it in-flow. */

import { THREE, clamp, buildPhone, createRenderer, PHONE_LOOK } from "./three-phone.js?v=3"

;(function () {
    if (typeof window === "undefined" || typeof document === "undefined") return
    var mount = document.querySelector(".hiwphone")
    if (!mount) return

    // ---- PhoneFlip3D property-control defaults: the shared device look
    // (three-phone.js PHONE_LOOK) + this phone's landscape body, flip + video ----
    var CFG = Object.assign({}, PHONE_LOOK, {
        faceAspect: 1.7778,
        // Force the display to the video's 16:9 so the 16:9 clip fills it with
        // no edge crop (cover == contain when aspects match).
        forceScreen16by9: true,
        fov: 26,
        fitMargin: 0.88,
        startRotationDeg: 180,
        endRotationDeg: 0,
        flipStart: 0.1,
        // ~30% faster spin: the flip completes over a 30%-shorter scroll span
        // (0.62 -> 0.43), so the phone is front-facing while it is still fully
        // in frame -- the video mounts + paints before the viewer scrolls past.
        flipEnd: 0.53,
        smoothing: 0.12,
        // Two clips that alternate (Streamable exposes no ended event, so we
        // swap on each clip's known duration). "No hot water" then "No cool".
        video1EmbedUrl: "https://streamable.com/e/9wb5p8",
        video2EmbedUrl: "https://streamable.com/e/ns5jtf",
        video1Seconds: 33.033,
        video2Seconds: 33.659,
        videoFit: "cover",
    })

    // Persistent code-level visual tilt on the phone group's Z axis (degrees).
    // Flip `-` to change lean direction.
    var PHONE_VISUAL_TILT_DEG = 8

    var reduce =
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion:reduce)").matches

    var easeInOutCubic = function (t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    }
    var withEmbedParams = function (url) {
        try {
            var parsed = new URL(url)
            parsed.searchParams.set("autoplay", "1")
            parsed.searchParams.set("muted", "1")
            parsed.searchParams.set("loop", "0") // play once; timer swaps clips
            return parsed.toString()
        } catch (e) {
            var glue = url.indexOf("?") >= 0 ? "&" : "?"
            return url + glue + "autoplay=1&muted=1&loop=0"
        }
    }



    // ---------- DOM (fallback + canvas + projected overlay) ----------
    // NB: position/overflow are owned by hiw-phone.css (absolute+overflow on
    // desktop so the phone crosses section edges; relative+contained on mobile).
    // Do NOT set them inline here or the desktop overflow layer breaks.

    var fallback = document.createElement("div")
    fallback.setAttribute("aria-hidden", "true")
    fallback.className = "hiwphone__fallback"

    var canvas = document.createElement("canvas")
    canvas.className = "hiwphone__canvas"

    var overlay = document.createElement("div")
    overlay.className = "hiwphone__overlay"

    var iframe = document.createElement("iframe")
    iframe.className = "hiwphone__iframe"
    iframe.setAttribute("title", "See Bolt answer a call")
    iframe.setAttribute("allow", "autoplay; fullscreen")
    iframe.setAttribute("tabindex", "-1")

    var htmlIsland = document.createElement("div")
    htmlIsland.className = "hiwphone__island"

    overlay.appendChild(iframe)
    overlay.appendChild(htmlIsland)
    mount.appendChild(fallback)
    mount.appendChild(canvas)
    mount.appendChild(overlay)

    var isInView = false
    var isFrontFacing = false
    var embedMounted = false

    // ---------- Three.js ----------
    var scene = new THREE.Scene()
    var camera = new THREE.PerspectiveCamera(CFG.fov, 1, 0.1, 200)
    var group = new THREE.Group()
    scene.add(group)

    var renderer, envMap, logoTexture, screenSheenTexture, resizeObserver
    var raf = 0,
        disposed = false,
        dirty = true,
        extraFrames = 3
    var previousRotation = NaN,
        previousWidth = 0,
        previousHeight = 0,
        previousOverlayKey = ""
    var currentFlip = 0,
        lastTs = 0,
        hasSnapped = false
    var firstFrameDone = false
    var tiltRad = THREE.MathUtils.degToRad(PHONE_VISUAL_TILT_DEG)

    var screenCorners = [
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
    ]
    var faceCorners = [
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3(),
    ]

    function markDirty() {
        dirty = true
    }



    function computeProgress() {
        // Viewport-relative progress over the mount as it crosses the screen.
        var rect = mount.getBoundingClientRect()
        var vh = window.innerHeight || 1
        var start = vh
        var end = -rect.height
        return clamp((start - rect.top) / (start - end), 0, 1)
    }

    var geomCtx = null // filled by init(): { screenLocal, faceLocal, fullFaceLocal, screenRadius }

    function updateOverlayProjection(frontFacing) {
        if (!geomCtx) return
        var width = mount.clientWidth,
            height = mount.clientHeight
        if (width <= 0 || height <= 0) return
        var s = geomCtx.screenLocal,
            f = geomCtx.fullFaceLocal
        screenCorners[0].set(s.x0, s.y0, s.z)
        screenCorners[1].set(s.x1, s.y0, s.z)
        screenCorners[2].set(s.x1, s.y1, s.z)
        screenCorners[3].set(s.x0, s.y1, s.z)
        faceCorners[0].set(f.x0, f.y0, f.z)
        faceCorners[1].set(f.x1, f.y0, f.z)
        faceCorners[2].set(f.x1, f.y1, f.z)
        faceCorners[3].set(f.x0, f.y1, f.z)
        var project = function (vv) {
            var p = vv.clone().applyMatrix4(group.matrixWorld).project(camera)
            return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height }
        }
        var sP = screenCorners.map(project)
        var sx = sP.map(function (p) {
            return p.x
        })
        var sy = sP.map(function (p) {
            return p.y
        })
        // The projected screen is a rotated quad (the phone carries the 8deg Z
        // tilt). Lay the overlay out as that rotated rect — centre, true edge
        // lengths, rotation — so the video sits ON the screen and tilts WITH
        // the phone, instead of a flat axis-aligned bounding box that leaves
        // the chassis edges showing and never rotates. Edge 0->1 is the display
        // width, 1->2 the height; a rigid rotation preserves both, so the
        // width/height aspect stays the screen's 16:9 (no extra crop).
        var cx = (sP[0].x + sP[1].x + sP[2].x + sP[3].x) / 4
        var cy = (sP[0].y + sP[1].y + sP[2].y + sP[3].y) / 4
        var wpx = Math.max(1, Math.hypot(sP[1].x - sP[0].x, sP[1].y - sP[0].y))
        var hpx = Math.max(1, Math.hypot(sP[2].x - sP[1].x, sP[2].y - sP[1].y))
        var angleRad = Math.atan2(sP[1].y - sP[0].y, sP[1].x - sP[0].x)
        var radius = Math.max(
            0,
            (geomCtx.screenRadius * wpx) / Math.max(0.01, s.x1 - s.x0)
        )
        var activeVisible = frontFacing && isInView
        overlay.style.left = cx - wpx / 2 + "px"
        overlay.style.top = cy - hpx / 2 + "px"
        overlay.style.width = wpx + "px"
        overlay.style.height = hpx + "px"
        overlay.style.transformOrigin = "center center"
        overlay.style.transform = "rotate(" + angleRad + "rad)"
        overlay.style.borderRadius = radius + "px"
        overlay.style.opacity = activeVisible ? "1" : "0"
        overlay.style.visibility = activeVisible ? "visible" : "hidden"
        // Interactive only when the video is up, so Streamable's own controls
        // (unmute / seek / fullscreen) work; the rest of the phone stays
        // pointer-events:none and never blocks the CTA or neighbours.
        overlay.style.pointerEvents = activeVisible ? "auto" : "none"

        var overlayKey =
            Math.round(cx) +
            "|" +
            Math.round(cy) +
            "|" +
            Math.round(wpx) +
            "|" +
            Math.round(hpx) +
            "|" +
            Math.round(angleRad * 180) +
            "|" +
            (activeVisible ? 1 : 0)
        if (overlayKey !== previousOverlayKey) {
            previousOverlayKey = overlayKey
            markDirty()
        }

        // Dynamic Island (HTML), mirrored over the video.
        var islandH = (CFG.islandLengthPercent / 100) * hpx
        var islandW = (CFG.islandWidthPercent / 100) * hpx
        var centerX = wpx - (CFG.islandEdgeOffsetPercent / 100) * wpx
        var centerY = hpx / 2
        htmlIsland.style.width = islandW + "px"
        htmlIsland.style.height = islandH + "px"
        htmlIsland.style.left = centerX - islandW / 2 + "px"
        htmlIsland.style.top = centerY - islandH / 2 + "px"
        htmlIsland.style.borderRadius = islandW / 2 + "px"
        htmlIsland.style.display = activeVisible ? "block" : "none"

        // Cover-crop the 16:9 iframe inside the (portrait) screen host.
        var sourceAspect = 16 / 9
        var containerAspect = wpx / Math.max(1e-6, hpx)
        var isCover = CFG.videoFit === "cover"
        var widthPct = 100,
            heightPct = 100,
            leftPct = 0,
            topPct = 0
        var condition = isCover
            ? containerAspect > sourceAspect
            : containerAspect < sourceAspect
        if (condition) {
            heightPct = (containerAspect / sourceAspect) * 100
            topPct = -(heightPct - 100) / 2
        } else {
            widthPct = (sourceAspect / Math.max(1e-6, containerAspect)) * 100
            leftPct = -(widthPct - 100) / 2
        }
        iframe.style.width = widthPct + "%"
        iframe.style.height = heightPct + "%"
        iframe.style.left = leftPct + "%"
        iframe.style.top = topPct + "%"
    }

    // ---- Two demo clips that alternate, with mute persistence ----
    // Streamable speaks the player.js (Embedly) protocol over postMessage:
    // events ready/play/pause/ended, methods mute/unmute/getMuted. We swap on
    // the `ended` event (precise; no hardcoded duration), and because there is
    // NO mute/volume event we poll getMuted so the viewer's mute/unmute choice
    // (made via the clip's native controls) is captured and re-applied to every
    // subsequent clip. Each clip is always mounted muted so autoplay is allowed,
    // then unmuted after `ready` if the viewer had chosen sound.
    var STREAMABLE_ORIGIN = "https://streamable.com"
    var activeClip = 0
    var userMuted = true // default muted -> autoplay always permitted
    var currentPlayer = null
    var mutePoll = 0
    var clipTimer = 0
    function clipUrl() {
        return activeClip === 0 ? CFG.video1EmbedUrl : CFG.video2EmbedUrl
    }
    function clipSeconds() {
        return activeClip === 0 ? CFG.video1Seconds : CFG.video2Seconds
    }
    // Minimal player.js client scoped to one Streamable iframe.
    function makeStreamablePlayer(frame) {
        var evHandlers = {},
            once = {},
            ready = false,
            queue = []
        function post(o) {
            try {
                frame.contentWindow.postMessage(
                    JSON.stringify(
                        Object.assign(
                            { context: "player.js", version: "0.0.1" },
                            o
                        )
                    ),
                    STREAMABLE_ORIGIN
                )
            } catch (e) {}
        }
        function send(o) {
            ready ? post(o) : queue.push(o)
        }
        function onMsg(e) {
            if (e.origin !== STREAMABLE_ORIGIN || e.source !== frame.contentWindow)
                return
            var d
            try {
                d = typeof e.data === "string" ? JSON.parse(e.data) : e.data
            } catch (_) {
                return
            }
            if (!d || d.context !== "player.js") return
            if (d.event === "ready") {
                ready = true
                for (var i = 0; i < queue.length; i++) post(queue[i])
                queue = []
                if (evHandlers.ready) evHandlers.ready()
            } else if (d.listener && once[d.listener]) {
                var cb = once[d.listener]
                delete once[d.listener]
                cb(d.value)
            } else if (d.event && evHandlers[d.event]) {
                evHandlers[d.event](d.value)
            }
        }
        window.addEventListener("message", onMsg)
        return {
            on: function (ev, cb) {
                evHandlers[ev] = cb
                send({ method: "addEventListener", value: ev, listener: ev })
            },
            getMuted: function (cb) {
                var id = "gm" + ++makeStreamablePlayer._n
                once[id] = cb
                send({ method: "getMuted", listener: id })
            },
            mute: function () {
                send({ method: "mute" })
            },
            unmute: function () {
                send({ method: "unmute" })
            },
            destroy: function () {
                window.removeEventListener("message", onMsg)
                evHandlers = {}
                once = {}
            },
        }
    }
    makeStreamablePlayer._n = 0

    function stopMutePoll() {
        if (mutePoll) {
            window.clearInterval(mutePoll)
            mutePoll = 0
        }
    }
    function teardownPlayer() {
        stopMutePoll()
        window.clearTimeout(clipTimer)
        if (currentPlayer) {
            currentPlayer.destroy()
            currentPlayer = null
        }
    }
    function mountClip() {
        teardownPlayer()
        var swapped = false
        function swap() {
            if (swapped || disposed || !embedMounted) return
            swapped = true
            activeClip = activeClip === 0 ? 1 : 0
            mountClip()
        }
        iframe.src = withEmbedParams(clipUrl())
        var p = makeStreamablePlayer(iframe)
        currentPlayer = p
        p.on("ready", function () {
            if (!userMuted) p.unmute() // carry the viewer's choice to this clip
            stopMutePoll()
            mutePoll = window.setInterval(function () {
                if (currentPlayer === p)
                    p.getMuted(function (m) {
                        if (typeof m === "boolean") userMuted = m
                    })
            }, 1000)
        })
        p.on("ended", swap)
        // Fallback: if `ended` never arrives (paused/stalled player), swap on
        // the clip's known duration + margin so alternation never stalls.
        clipTimer = window.setTimeout(swap, Math.round(clipSeconds() * 1000) + 2500)
    }
    function setEmbed(active) {
        if (active === embedMounted) return
        embedMounted = active
        if (active) {
            mountClip()
        } else {
            teardownPlayer()
            iframe.src = ""
            activeClip = 0 // next time the phone faces front, start on clip 1
        }
    }

    function init() {
        try {
            renderer = createRenderer(canvas)
        } catch (e) {
            fallback.style.opacity = "1"
            return
        }

        var built = buildPhone(scene, group, renderer, CFG, function () {
            return disposed
        }, function () {
            markDirty()
            extraFrames = Math.max(extraFrames, 2)
        })
        screenSheenTexture = built.screenSheenTexture
        envMap = built.envMap
        geomCtx = built.geomCtx
        var faceWidth = geomCtx.faceWidth
        var faceHeight = geomCtx.faceHeight

        function resize() {
            if (!renderer) return
            var width = Math.max(1, mount.clientWidth)
            var height = Math.max(1, mount.clientHeight)
            var dpr = clamp(window.devicePixelRatio || 1, 1, 2)
            renderer.setPixelRatio(dpr)
            renderer.setSize(width, height, false)
            camera.aspect = width / height
            camera.fov = CFG.fov
            camera.updateProjectionMatrix()
            var fovRad = (camera.fov * Math.PI) / 180
            var distH = (faceHeight * 0.5) / Math.tan(fovRad / 2)
            var distW =
                (faceWidth * 0.5) / (Math.tan(fovRad / 2) * camera.aspect)
            camera.position.set(
                0,
                0,
                Math.max(distH, distW) / Math.max(0.1, CFG.fitMargin)
            )
            camera.lookAt(0, 0, 0)
            previousWidth = width
            previousHeight = height
            markDirty()
        }
        resize()

        window.addEventListener("scroll", markDirty, { passive: true })
        window.addEventListener("resize", resize)
        if ("ResizeObserver" in window) {
            resizeObserver = new ResizeObserver(resize)
            resizeObserver.observe(mount)
        }

        function loop(ts) {
            if (disposed || !renderer) return
            raf = window.requestAnimationFrame(loop)
            var raw = computeProgress()
            var mapped = clamp(
                (raw - CFG.flipStart) /
                    Math.max(0.0001, CFG.flipEnd - CFG.flipStart),
                0,
                1
            )
            var target = easeInOutCubic(mapped)
            // The flip is core to the "How It Works" story, so it tracks scroll
            // for everyone. Under prefers-reduced-motion we skip the eased
            // smoothing below (the `reduce` branch snaps currentFlip straight to
            // the scroll position) so there is no autonomous/inertial motion —
            // the phone only moves when the user themselves scrolls.
            var dt = Math.min(0.05, lastTs > 0 ? (ts - lastTs) / 1000 : 0.016)
            lastTs = ts
            if (!hasSnapped || reduce) {
                currentFlip = target
                hasSnapped = true
                extraFrames = Math.max(extraFrames, 2)
            } else if (CFG.smoothing <= 0.001) {
                currentFlip = target
            } else {
                var lambda = 1 - Math.exp(-dt / CFG.smoothing)
                currentFlip += (target - currentFlip) * clamp(lambda, 0, 1)
            }

            var startRad = (CFG.startRotationDeg * Math.PI) / 180
            var endRad = (CFG.endRotationDeg * Math.PI) / 180
            var rot = startRad + (endRad - startRad) * currentFlip
            // --- persistent 8deg tilt on the group's Z axis (brief requirement) ---
            group.rotation.set(rot, 0, tiltRad)
            group.updateMatrixWorld(true)

            var frontFacing =
                currentFlip > 0.995 &&
                Math.abs((rot * 180) / Math.PI - CFG.endRotationDeg) < 0.5
            if (frontFacing !== isFrontFacing) {
                isFrontFacing = frontFacing
                setEmbed(frontFacing && isInView)
            }
            updateOverlayProjection(frontFacing)

            var sizeChanged =
                mount.clientWidth !== previousWidth ||
                mount.clientHeight !== previousHeight
            var shouldRender =
                dirty ||
                extraFrames > 0 ||
                sizeChanged ||
                Math.abs(rot - previousRotation) > 0.00005
            if (shouldRender) {
                renderer.render(scene, camera)
                previousRotation = rot
                dirty = false
                extraFrames = Math.max(0, extraFrames - 1)
                if (!firstFrameDone) {
                    firstFrameDone = true
                    fallback.style.opacity = "0"
                }
            }
        }
        extraFrames = 3
        raf = window.requestAnimationFrame(loop)
    }

    // Only run the loop while the section is near the viewport.
    if ("IntersectionObserver" in window) {
        new IntersectionObserver(
            function (entries) {
                var vis = entries.some(function (e) {
                    return e.isIntersecting
                })
                isInView = vis
                if (vis) markDirty()
                setEmbed(isFrontFacing && isInView)
            },
            { threshold: 0, rootMargin: "20% 0px 20% 0px" }
        ).observe(mount)
    } else {
        isInView = true
    }

    init()

    window.addEventListener(
        "pagehide",
        function () {
            disposed = true
            teardownPlayer()
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
