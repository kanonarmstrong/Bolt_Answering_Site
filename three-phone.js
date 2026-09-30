/* Shared procedural 3D phone (Three.js). The How It Works phone
   (hiw-phone.js) and the home-hero phone (hero-phone.js) are built by the same
   code: chassis, bevels, bezel, display + sheen, Dynamic Island, rear camera
   island, lenses, logo, materials, lights and the reflection environment. So
   the two read as the same device; each page script owns its own pose, motion
   and on-screen content.

   The body is modelled LANDSCAPE: faceWidth 10 on X, faceHeight = 10 /
   faceAspect on Y, the Dynamic Island on the +X edge. A portrait phone is the
   same body turned 90deg about Z by its caller. `screenAspect` (long/short)
   clamps the display's long side, e.g. 16/9 for the How It Works video; the
   legacy `forceScreen16by9` flag still means exactly that. */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js"

export { THREE }

// The shared look: every material, colour and proportion of the device. Both
// phones spread this into their config, so a look change lands on both.
export var PHONE_LOOK = {
    cornerRadiusPercent: 12.15,
    thicknessPercent: 10.5,
    bevelPercent: 12,
    bezelPercent: 2.7,
    bezelColor: "#0B0C0E",
    screenColor: "#07080A",
    screenSheen: 0.5,
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
    lightIntensity: 1,
}

// Body aspect (long/short) whose display comes out at exactly `screenAspect`
// (long/short) with the same bezel on every side. buildPhone insets the front
// cap by the bevel and the display by the bezel, both proportional to the
// short side H: display = (10 - 2(k1+k2)H) x (1 - 2k1 - 2k2)H, so
// faceAspect = S(1 - 2k1 - 2k2) + 2(k1 + k2).
export function faceAspectForScreen(look, screenAspect) {
    var k1 = Math.min(look.bevelPercent / 100, 0.45) * (look.thicknessPercent / 100)
    var k2 = look.bezelPercent / 100
    return screenAspect * (1 - 2 * k1 - 2 * k2) + 2 * (k1 + k2)
}

export function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v))
}

export function makeRoundedRectShape(width, height, radius) {
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

export function reorderGeometryByFaceNormals(source) {
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

export function buildEnvMap(targetRenderer) {
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

export function createScreenSheenTexture(cfg) {
    var cv = document.createElement("canvas")
    cv.width = 512
    cv.height = 288
    var ctx = cv.getContext("2d")
    if (!ctx) return null
    var sheen = clamp(cfg.screenSheen, 0, 1)
    var base = new THREE.Color(cfg.screenColor)
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

export function createRenderer(canvas) {
    var renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
    })
    renderer.setClearAlpha(0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NoToneMapping
    return renderer
}

// Builds the phone into `group` (meshes) and `scene` (lights + environment).
// Returns { geomCtx, screenSheenTexture, envMap, logoTexture } — geomCtx holds
// the display rect in the group's local space for projecting DOM onto it.
export function buildPhone(scene, group, renderer, cfg, isDisposed, onLogo) {
    var out = { geomCtx: null, logoTexture: null }
    var bodyAspect = clamp(cfg.faceAspect, 0.2, 8)
    var faceWidth = 10
    var faceHeight = faceWidth / bodyAspect
    var thickness = (cfg.thicknessPercent / 100) * faceHeight
    var unclampedBevel = (cfg.bevelPercent / 100) * thickness
    var bevel = Math.min(unclampedBevel, thickness * 0.45 - 0.0001)
    var cornerFrac = clamp(cfg.cornerRadiusPercent / 100, 0.02, 0.5)
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
            color: cfg.bezelColor,
            roughness: 0.55,
            metalness: 0.05,
        }),
        new THREE.MeshStandardMaterial({
            color: cfg.backPanelColor,
            roughness: cfg.backPanelRoughness,
            metalness: cfg.backPanelMetalness,
        }),
        new THREE.MeshStandardMaterial({
            color: cfg.sideColor,
            metalness: cfg.sideMetalness,
            roughness: cfg.sideRoughness,
        }),
    ]
    var mesh = new THREE.Mesh(reordered.geometry, chassisMaterials)
    group.add(mesh)

    var capWidth = reordered.capMaxX - reordered.capMinX
    var capHeight = reordered.capMaxY - reordered.capMinY
    var bezelInset = (cfg.bezelPercent / 100) * faceHeight
    var capCornerRadius = Math.max(0, outerRadius - bevel)
    var displayHeight = Math.max(0.001, capHeight - bezelInset * 2)
    var displayWidth = Math.max(0.001, capWidth - bezelInset * 2)
    var screenAspect = cfg.screenAspect || (cfg.forceScreen16by9 ? 16 / 9 : 0)
    if (screenAspect)
        displayWidth = Math.min(displayWidth, displayHeight * screenAspect)
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
    var screenSheenTexture = createScreenSheenTexture(cfg)
    var displayMaterial = new THREE.MeshStandardMaterial({
        color: cfg.screenColor,
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
    var islandLen = (cfg.islandLengthPercent / 100) * displayShortSide
    var islandWid = Math.max(
        0.0005,
        (cfg.islandWidthPercent / 100) * displayShortSide
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
        displayX1 - (cfg.islandEdgeOffsetPercent / 100) * displayLongSide,
        (displayY0 + displayY1) * 0.5,
        reordered.frontCapZ + 0.003
    )
    group.add(islandMesh)

    // Rear camera island + lenses.
    var islandSize = (cfg.cameraIslandSizePercent / 100) * faceHeight
    var islandDepth = Math.max(
        0.0005,
        (cfg.cameraIslandHeightPercent / 100) * thickness
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
        color: cfg.cameraIslandColor,
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
            color: cfg.lensRingColor,
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
        cfg.logoUrl,
        function (tex) {
            if (isDisposed()) {
                tex.dispose()
                return
            }
            tex.colorSpace = THREE.SRGBColorSpace
            tex.flipY = false
            tex.wrapS = THREE.ClampToEdgeWrapping
            tex.repeat.x = -1
            tex.offset.x = 1
            tex.needsUpdate = true
            out.logoTexture = tex
            var sourceW = (tex.image && tex.image.width) || 209
            var sourceH = (tex.image && tex.image.height) || 87
            var logoW = (cfg.logoWidthPercent / 100) * faceWidth
            var logoH = logoW * (sourceH / Math.max(1, sourceW))
            var logoGeometry = new THREE.PlaneGeometry(logoW, logoH)
            var logoMaterial = new THREE.MeshBasicMaterial({
                map: tex,
                transparent: true,
                opacity: clamp(cfg.logoOpacity, 0, 1),
                toneMapped: false,
                depthWrite: false,
            })
            var logoMesh = new THREE.Mesh(logoGeometry, logoMaterial)
            logoMesh.position.set(0, 0, reordered.backCapZ - 0.0015)
            logoMesh.rotation.y = Math.PI
            group.add(logoMesh)
            if (onLogo) onLogo()
        },
        undefined,
        function () {}
    )

    // Lights.
    var hemi = new THREE.HemisphereLight(
        0xffffff,
        0x22263a,
        0.45 * cfg.lightIntensity
    )
    var key = new THREE.DirectionalLight(0xffffff, 0.85 * cfg.lightIntensity)
    key.position.set(-5, 5, 5)
    var rim = new THREE.DirectionalLight(0xbfd6ff, 0.3 * cfg.lightIntensity)
    rim.position.set(4, -2, -5)
    var rearFill = new THREE.DirectionalLight(
        0xffffff,
        0.6 * cfg.lightIntensity
    )
    rearFill.position.set(-4, 3.5, -6)
    scene.add(hemi, key, rim, rearFill)
    var envMap = buildEnvMap(renderer)
    scene.environment = envMap

    out.geomCtx = {
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
    out.screenSheenTexture = screenSheenTexture
    out.envMap = envMap
    return out
}
