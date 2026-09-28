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

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js"

;(function () {
    if (typeof window === "undefined" || typeof document === "undefined") return
    var mount = document.querySelector(".hiwphone")
    if (!mount) return

    // ---- PhoneFlip3D property-control defaults, inlined ----
    var CFG = {
        faceAspect: 1.7778,
        cornerRadiusPercent: 12.15,
        thicknessPercent: 10.5,
        bevelPercent: 12,
        bezelPercent: 2.7,
        forceScreen16by9: false,
        bezelColor: "#0B0C0E",
        screenColor: "#07080A",
        screenSheen: 0.5,
        // Force the display to the video's 16:9 so the 16:9 clip fills it with
        // no edge crop (cover == contain when aspects match).
        forceScreen16by9: true,
        islandLengthPercent: 34,
        islandWidthPercent: 9,
        islandEdgeOffsetPercent: 4.5,
        backPanelColor: "#2A2C31",
        backPanelRoughness: 0.42,
        backPanelMetalness: 0.35,
        cameraIslandSizePercent: 33,
        cameraIslandHeightPercent: 18,
        cameraIslandColor: "#23252A",
        lensRingColor: "#4A4E56",
        logoUrl: "assets/hiw-phone-logo.png",
        logoWidthPercent: 11,
        logoOpacity: 0.85,
        sideColor: "#7E848C",
        sideMetalness: 0.62,
        sideRoughness: 0.4,
        fov: 26,
        fitMargin: 0.88,
        lightIntensity: 1,
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
    }

    // Persistent code-level visual tilt on the phone group's Z axis (degrees).
    // Flip `-` to change lean direction.
    var PHONE_VISUAL_TILT_DEG = 8

    var reduce =
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion:reduce)").matches

    var clamp = function (v, min, max) {
        return Math.min(max, Math.max(min, v))
    }
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

    function makeRoundedRectShape(width, height, radius) {
        var hw = width / 2,
            hh = height / 2
        var r = Math.min(radius, hw, hh)
        var shape = new THREE.Shape()
        shape.moveTo(-hw + r, -hh)
        shape.lineTo(hw - r, -hh)
        shape.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false)
        shape.lineTo(hw, hh - r)
        shape.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false)
        shape.lineTo(-hw + r, hh)
        shape.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false)
        shape.lineTo(-hw, -hh + r)
        shape.absarc(-hw + r, -hh + r, r, Math.PI, (Math.PI * 3) / 2, false)
        return shape
    }

    function reorderGeometryByFaceNormals(source) {
        var geom = source.index ? source.toNonIndexed() : source.clone()
        var positions = geom.getAttribute("position").array
        var normals = geom.getAttribute("normal").array
        var uvs = geom.getAttribute("uv").array
        var front = [],
            back = [],
            side = []
        var frontCapZ = -Infinity,
            backCapZ = Infinity
        var triCount = positions.length / 9
        for (var i = 0; i < triCount; i++) {
            var ni = i * 9
            var nz = (normals[ni + 2] + normals[ni + 5] + normals[ni + 8]) / 3
            if (nz > 0.9) {
                front.push(i)
                frontCapZ = Math.max(
                    frontCapZ,
                    positions[ni + 2],
                    positions[ni + 5],
                    positions[ni + 8]
                )
            } else if (nz < -0.9) {
                back.push(i)
                backCapZ = Math.min(
                    backCapZ,
                    positions[ni + 2],
                    positions[ni + 5],
                    positions[ni + 8]
                )
            } else side.push(i)
        }
        var capMinX = Infinity,
            capMaxX = -Infinity,
            capMinY = Infinity,
            capMaxY = -Infinity
        var capTris = front.concat(back)
        for (var t = 0; t < capTris.length; t++) {
            var base = capTris[t] * 9
            for (var v = 0; v < 3; v++) {
                var x = positions[base + v * 3],
                    y = positions[base + v * 3 + 1]
                if (x < capMinX) capMinX = x
                if (x > capMaxX) capMaxX = x
                if (y < capMinY) capMinY = y
                if (y > capMaxY) capMaxY = y
            }
        }
        if (!isFinite(capMinX) || !isFinite(capMinY)) {
            capMinX = -0.5
            capMaxX = 0.5
            capMinY = -0.5
            capMaxY = 0.5
        }
        var capWidth = Math.max(1e-6, capMaxX - capMinX)
        var capHeight = Math.max(1e-6, capMaxY - capMinY)
        var ordered = front.concat(back, side)
        var outPos = new Float32Array(ordered.length * 9)
        var outNorm = new Float32Array(ordered.length * 9)
        var outUv = new Float32Array(ordered.length * 6)
        ordered.forEach(function (tri, orderIndex) {
            var srcP = tri * 9,
                srcUv = tri * 6,
                dstP = orderIndex * 9,
                dstUv = orderIndex * 6
            for (var k = 0; k < 9; k++) {
                outPos[dstP + k] = positions[srcP + k]
                outNorm[dstP + k] = normals[srcP + k]
            }
            var isFront = orderIndex < front.length
            var isBack =
                orderIndex >= front.length &&
                orderIndex < front.length + back.length
            for (var vv = 0; vv < 3; vv++) {
                var px = outPos[dstP + vv * 3],
                    py = outPos[dstP + vv * 3 + 1]
                if (isFront) {
                    outUv[dstUv + vv * 2] = clamp((px - capMinX) / capWidth, 0, 1)
                    outUv[dstUv + vv * 2 + 1] = clamp(
                        (py - capMinY) / capHeight,
                        0,
                        1
                    )
                } else if (isBack) {
                    outUv[dstUv + vv * 2] = clamp((px - capMinX) / capWidth, 0, 1)
                    outUv[dstUv + vv * 2 + 1] =
                        1 - clamp((py - capMinY) / capHeight, 0, 1)
                } else {
                    outUv[dstUv + vv * 2] = uvs[srcUv + vv * 2]
                    outUv[dstUv + vv * 2 + 1] = uvs[srcUv + vv * 2 + 1]
                }
            }
        })
        var out = new THREE.BufferGeometry()
        out.setAttribute("position", new THREE.BufferAttribute(outPos, 3))
        out.setAttribute("normal", new THREE.BufferAttribute(outNorm, 3))
        out.setAttribute("uv", new THREE.BufferAttribute(outUv, 2))
        out.clearGroups()
        out.addGroup(0, front.length * 3, 0)
        out.addGroup(front.length * 3, back.length * 3, 1)
        out.addGroup((front.length + back.length) * 3, side.length * 3, 2)
        geom.dispose()
        return {
            geometry: out,
            capMinX: capMinX,
            capMaxX: capMaxX,
            capMinY: capMinY,
            capMaxY: capMaxY,
            frontCapZ: isFinite(frontCapZ) ? frontCapZ : 0,
            backCapZ: isFinite(backCapZ) ? backCapZ : 0,
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

    function buildEnvMap(targetRenderer) {
        var envScene = new THREE.Scene()
        var mats = [],
            geos = []
        var makeBox = function (size, pos, color) {
            var geo = new THREE.BoxGeometry(size[0], size[1], size[2])
            var mat = new THREE.MeshBasicMaterial({ color: color })
            var box = new THREE.Mesh(geo, mat)
            box.position.set(pos[0], pos[1], pos[2])
            envScene.add(box)
            mats.push(mat)
            geos.push(geo)
        }
        makeBox([12, 0.2, 6], [0, 3.1, 0], 0xffffff)
        makeBox([1.8, 3.8, 5], [-5, 0.5, 0], 0xb8c4d6)
        makeBox([1.8, 3.8, 5], [5, 0.2, -0.6], 0x9ca8b9)
        makeBox([30, 30, 30], [0, 0, 0], 0x08090d)
        var pmrem = new THREE.PMREMGenerator(targetRenderer)
        var rt = pmrem.fromScene(envScene, 0.04)
        pmrem.dispose()
        geos.forEach(function (g) {
            g.dispose()
        })
        mats.forEach(function (m) {
            m.dispose()
        })
        envScene.clear()
        return rt.texture
    }

    function createScreenSheenTexture() {
        var cv = document.createElement("canvas")
        cv.width = 512
        cv.height = 288
        var ctx = cv.getContext("2d")
        if (!ctx) return null
        var sheen = clamp(CFG.screenSheen, 0, 1)
        var base = new THREE.Color(CFG.screenColor)
        var lifted = base.clone().lerp(new THREE.Color("#ffffff"), 0.09)
        ctx.fillStyle = base.getStyle()
        ctx.fillRect(0, 0, cv.width, cv.height)
        var grad = ctx.createLinearGradient(0, 0, cv.width, cv.height)
        grad.addColorStop(
            0,
            "rgba(" +
                Math.round(lifted.r * 255) +
                "," +
                Math.round(lifted.g * 255) +
                "," +
                Math.round(lifted.b * 255) +
                "," +
                0.1 * sheen +
                ")"
        )
        grad.addColorStop(0.65, "rgba(255,255,255,0)")
        grad.addColorStop(1, "rgba(255,255,255,0)")
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, cv.width, cv.height)
        var tex = new THREE.CanvasTexture(cv)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.needsUpdate = true
        return tex
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
            renderer = new THREE.WebGLRenderer({
                canvas: canvas,
                alpha: true,
                antialias: true,
                powerPreference: "high-performance",
            })
            renderer.setClearAlpha(0)
            renderer.outputColorSpace = THREE.SRGBColorSpace
            renderer.toneMapping = THREE.NoToneMapping
        } catch (e) {
            fallback.style.opacity = "1"
            return
        }

        var bodyAspect = clamp(CFG.faceAspect, 0.2, 8)
        var faceWidth = 10
        var faceHeight = faceWidth / bodyAspect
        var thickness = (CFG.thicknessPercent / 100) * faceHeight
        var unclampedBevel = (CFG.bevelPercent / 100) * thickness
        var bevel = Math.min(unclampedBevel, thickness * 0.45 - 0.0001)
        var cornerFrac = clamp(CFG.cornerRadiusPercent / 100, 0.02, 0.5)
        var outerRadius = cornerFrac * faceHeight
        var insetW = Math.max(0.001, faceWidth - 2 * bevel)
        var insetH = Math.max(0.001, faceHeight - 2 * bevel)
        var shape = makeRoundedRectShape(
            insetW,
            insetH,
            Math.max(0.0001, outerRadius - bevel)
        )
        var extrude = new THREE.ExtrudeGeometry(shape, {
            depth: Math.max(0.0001, thickness - 2 * bevel),
            bevelEnabled: true,
            bevelThickness: bevel,
            bevelSize: bevel,
            bevelSegments: 4,
            curveSegments: 32,
            steps: 1,
        })
        extrude.center()
        var reordered = reorderGeometryByFaceNormals(extrude)
        extrude.dispose()

        var chassisMaterials = [
            new THREE.MeshStandardMaterial({
                color: CFG.bezelColor,
                roughness: 0.55,
                metalness: 0.05,
            }),
            new THREE.MeshStandardMaterial({
                color: CFG.backPanelColor,
                roughness: CFG.backPanelRoughness,
                metalness: CFG.backPanelMetalness,
            }),
            new THREE.MeshStandardMaterial({
                color: CFG.sideColor,
                metalness: CFG.sideMetalness,
                roughness: CFG.sideRoughness,
            }),
        ]
        var mesh = new THREE.Mesh(reordered.geometry, chassisMaterials)
        group.add(mesh)

        var capWidth = reordered.capMaxX - reordered.capMinX
        var capHeight = reordered.capMaxY - reordered.capMinY
        var bezelInset = (CFG.bezelPercent / 100) * faceHeight
        var capCornerRadius = Math.max(0, outerRadius - bevel)
        var displayHeight = Math.max(0.001, capHeight - bezelInset * 2)
        var displayWidth = Math.max(0.001, capWidth - bezelInset * 2)
        if (CFG.forceScreen16by9)
            displayWidth = Math.min(displayWidth, displayHeight * (16 / 9))
        var displayX0 = reordered.capMinX + (capWidth - displayWidth) / 2
        var displayY0 = reordered.capMinY + bezelInset
        var displayX1 = displayX0 + displayWidth
        var displayY1 = displayY0 + displayHeight
        var displayRadius = clamp(
            capCornerRadius - (displayX0 - reordered.capMinX),
            0,
            Math.min(displayWidth, displayHeight) / 2
        )
        var displayShape = makeRoundedRectShape(
            displayWidth,
            displayHeight,
            displayRadius
        )
        var displayGeometry = new THREE.ShapeGeometry(displayShape, 32)
        screenSheenTexture = createScreenSheenTexture()
        var displayMaterial = new THREE.MeshStandardMaterial({
            color: CFG.screenColor,
            map: screenSheenTexture || null,
            roughness: 0.1,
            metalness: 0.25,
        })
        var displayMesh = new THREE.Mesh(displayGeometry, displayMaterial)
        displayMesh.position.set(
            (displayX0 + displayX1) * 0.5,
            (displayY0 + displayY1) * 0.5,
            reordered.frontCapZ + 0.0015
        )
        group.add(displayMesh)

        // Front Dynamic Island (mesh; the HTML island overlays it when the
        // video is up).
        var displayShortSide = Math.min(displayWidth, displayHeight)
        var displayLongSide = Math.max(displayWidth, displayHeight)
        var islandLen = (CFG.islandLengthPercent / 100) * displayShortSide
        var islandWid = Math.max(
            0.0005,
            (CFG.islandWidthPercent / 100) * displayShortSide
        )
        var islandShape = makeRoundedRectShape(
            islandWid,
            islandLen,
            islandWid / 2
        )
        var islandGeometry = new THREE.ShapeGeometry(islandShape, 32)
        var islandMaterial = new THREE.MeshStandardMaterial({
            color: "#000000",
            roughness: 0.35,
            metalness: 0,
        })
        var islandMesh = new THREE.Mesh(islandGeometry, islandMaterial)
        islandMesh.position.set(
            displayX1 - (CFG.islandEdgeOffsetPercent / 100) * displayLongSide,
            (displayY0 + displayY1) * 0.5,
            reordered.frontCapZ + 0.003
        )
        group.add(islandMesh)

        // Rear camera island + lenses.
        var islandSize = (CFG.cameraIslandSizePercent / 100) * faceHeight
        var islandDepth = Math.max(
            0.0005,
            (CFG.cameraIslandHeightPercent / 100) * thickness
        )
        var islandBevelSize = Math.min(islandDepth * 0.3, islandSize * 0.02)
        var baseSink = islandBevelSize * 2
        var islandShapeBack = makeRoundedRectShape(
            islandSize,
            islandSize,
            islandSize * 0.22
        )
        var islandBackGeometry = new THREE.ExtrudeGeometry(islandShapeBack, {
            depth: islandDepth + baseSink,
            bevelEnabled: true,
            bevelThickness: islandBevelSize,
            bevelSize: islandBevelSize,
            bevelSegments: 4,
            curveSegments: 32,
            steps: 1,
        })
        islandBackGeometry.translate(0, 0, -islandDepth)
        var islandBackMaterial = new THREE.MeshStandardMaterial({
            color: CFG.cameraIslandColor,
            roughness: 0.38,
            metalness: 0.45,
        })
        var islandBackMesh = new THREE.Mesh(
            islandBackGeometry,
            islandBackMaterial
        )
        islandBackMesh.position.set(
            reordered.capMinX + 0.866 * capWidth,
            reordered.capMinY + 0.239 * capHeight,
            reordered.backCapZ
        )
        group.add(islandBackMesh)

        var lensPositions = [
            [0.27, 0.28],
            [0.74, 0.28],
            [0.5, 0.73],
        ]
        var lensRadius = islandSize * 0.16
        var barrelDepth = islandDepth * 0.25
        lensPositions.forEach(function (lp) {
            var lx = lp[0],
                ly = lp[1]
            var ringGeometry = new THREE.CylinderGeometry(
                lensRadius,
                lensRadius,
                barrelDepth,
                32
            )
            ringGeometry.rotateX(Math.PI / 2)
            var ringMaterial = new THREE.MeshStandardMaterial({
                color: CFG.lensRingColor,
                roughness: 0.3,
                metalness: 0.45,
            })
            var ringMesh = new THREE.Mesh(ringGeometry, ringMaterial)
            ringMesh.position.set(
                islandBackMesh.position.x + (lx - 0.5) * islandSize,
                islandBackMesh.position.y + (ly - 0.5) * islandSize,
                reordered.backCapZ - islandDepth - barrelDepth / 2
            )
            group.add(ringMesh)
            var glassRadius = lensRadius * 0.7
            var glassGeometry = new THREE.CylinderGeometry(
                glassRadius,
                glassRadius,
                barrelDepth * 0.28,
                32
            )
            glassGeometry.rotateX(Math.PI / 2)
            var glassMaterial = new THREE.MeshStandardMaterial({
                color: "#06070B",
                roughness: 0.05,
                metalness: 0.5,
            })
            var glassMesh = new THREE.Mesh(glassGeometry, glassMaterial)
            glassMesh.position.set(
                ringMesh.position.x,
                ringMesh.position.y,
                reordered.backCapZ - islandDepth - barrelDepth
            )
            group.add(glassMesh)
        })

        // Rear logo.
        var loader = new THREE.TextureLoader()
        loader.setCrossOrigin("anonymous")
        loader.load(
            CFG.logoUrl,
            function (tex) {
                if (disposed) {
                    tex.dispose()
                    return
                }
                tex.colorSpace = THREE.SRGBColorSpace
                tex.flipY = false
                tex.wrapS = THREE.ClampToEdgeWrapping
                tex.repeat.x = -1
                tex.offset.x = 1
                tex.needsUpdate = true
                logoTexture = tex
                var sourceW = (tex.image && tex.image.width) || 209
                var sourceH = (tex.image && tex.image.height) || 87
                var logoW = (CFG.logoWidthPercent / 100) * faceWidth
                var logoH = logoW * (sourceH / Math.max(1, sourceW))
                var logoGeometry = new THREE.PlaneGeometry(logoW, logoH)
                var logoMaterial = new THREE.MeshBasicMaterial({
                    map: tex,
                    transparent: true,
                    opacity: clamp(CFG.logoOpacity, 0, 1),
                    toneMapped: false,
                    depthWrite: false,
                })
                var logoMesh = new THREE.Mesh(logoGeometry, logoMaterial)
                logoMesh.position.set(0, 0, reordered.backCapZ - 0.0015)
                logoMesh.rotation.y = Math.PI
                group.add(logoMesh)
                markDirty()
                extraFrames = Math.max(extraFrames, 2)
            },
            undefined,
            function () {}
        )

        // Lights.
        var hemi = new THREE.HemisphereLight(
            0xffffff,
            0x22263a,
            0.45 * CFG.lightIntensity
        )
        var key = new THREE.DirectionalLight(0xffffff, 0.85 * CFG.lightIntensity)
        key.position.set(-5, 5, 5)
        var rim = new THREE.DirectionalLight(0xbfd6ff, 0.3 * CFG.lightIntensity)
        rim.position.set(4, -2, -5)
        var rearFill = new THREE.DirectionalLight(
            0xffffff,
            0.6 * CFG.lightIntensity
        )
        rearFill.position.set(-4, 3.5, -6)
        scene.add(hemi, key, rim, rearFill)
        envMap = buildEnvMap(renderer)
        scene.environment = envMap

        geomCtx = {
            screenLocal: {
                x0: displayX0,
                y0: displayY0,
                x1: displayX1,
                y1: displayY1,
                z: reordered.frontCapZ + 0.0015,
            },
            fullFaceLocal: {
                x0: -faceWidth / 2,
                y0: -faceHeight / 2,
                x1: faceWidth / 2,
                y1: faceHeight / 2,
                z: reordered.frontCapZ,
            },
            screenRadius: displayRadius,
            faceWidth: faceWidth,
            faceHeight: faceHeight,
        }

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
