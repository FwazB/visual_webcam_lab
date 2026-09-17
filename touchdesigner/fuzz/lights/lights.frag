// TouchDesigner GLSL TOP pixel shader; TD supplies the GLSL version and inputs.
// Input 0: camera RGBA. Input 1: feathered person mask (white person, black room).
// This is a flat image mask, not a depth map. Use the same shader for both views.
// uLight: behind amount, front amount, speed, absolute time in seconds.
// uTint: light RGB, mask-valid flag. uView.x: 1 camera preview, 0 light-only feed.
// Check: invalid mask -> original preview / opaque black feed; Amounts 0 -> same.
// A white mask excludes behind light; a black mask excludes front light.

uniform vec4 uLight;
uniform vec4 uTint;
uniform vec4 uView;
layout(location = 0) out vec4 fragColor;

#if TD_NUM_2D_INPUTS > 1
float personAt(vec2 uv)
{
    // Keep linear filtering inside the mask's edge texels; a black extension
    // would otherwise leak background light along a full-frame silhouette.
    vec2 inset = uTD2DInfos[1].res.xy * 0.5;
    return clamp(texture(sTD2DInputs[1], clamp(uv, inset, vec2(1.0) - inset)).r, 0.0, 1.0);
}
#endif

void main()
{
    vec2 uv = vUV.xy;
    vec4 camera = vec4(0.0, 0.0, 0.0, 1.0);
#if TD_NUM_2D_INPUTS > 0
    camera = texture(sTD2DInputs[0], uv);
#endif
    bool preview = uView.x > 0.5;
    vec4 unlit = preview ? camera : vec4(0.0, 0.0, 0.0, 1.0);
#if TD_NUM_2D_INPUTS < 2
    fragColor = TDOutputSwizzle(unlit);
    return;
#else
    if (uTint.a < 0.5)
    {
        fragColor = TDOutputSwizzle(unlit);
        return;
    }

    float person = personAt(uv);
    // Finite differences over a small, resolution-independent screen footprint.
    vec2 offset = uTDOutputInfo.res.xy * 12.0;
    float left = personAt(uv - vec2(offset.x, 0.0));
    float right = personAt(uv + vec2(offset.x, 0.0));
    float below = personAt(uv - vec2(0.0, offset.y));
    float above = personAt(uv + vec2(0.0, offset.y));
    vec2 gradient = 0.5 * vec2(right - left, above - below);
    float contour = smoothstep(0.01, 0.55, length(gradient));
    float halo = max(0.0, max(max(left, right), max(below, above)) - person);

    float aspect = uTDOutputInfo.res.z / max(uTDOutputInfo.res.w, 1.0);
    vec2 position = (uv - 0.5) * vec2(aspect, 1.0);
    float t = uLight.w * clamp(uLight.z, 0.0, 1.0);
    float curve = 0.06 * sin(position.y * 4.0 + t * 0.13);
    float phase = 6.2831853 * (position.x * 0.85 + position.y * 0.55 + curve - t * 0.025);
    float band = pow(0.5 + 0.5 * cos(phase), 6.0);
    float crossPhase = 6.2831853 * (-position.x * 0.42 + position.y * 0.72 + t * 0.018);
    float crossBand = pow(0.5 + 0.5 * cos(crossPhase), 5.0);

    float behind = clamp(uLight.x, 0.0, 1.0) * (1.0 - person)
                 * (0.50 * band + 0.16 * crossBand + 0.25 * halo);
    // Keep foreground light subtle, especially high in the frame. There is no
    // face detector here: clean detail comes from low gain and screen blending.
    float foregroundWeight = 0.30 + 0.70 * (1.0 - smoothstep(0.50, 0.90, uv.y));
    float front = clamp(uLight.y, 0.0, 1.0) * person * foregroundWeight
                * (0.14 * crossBand + 0.10 * contour);
    vec3 tint = clamp(uTint.rgb, vec3(0.0), vec3(1.0));
    vec3 light = clamp(tint * (behind + front), vec3(0.0), vec3(1.0));

    // Screen-style addition preserves highlights and samples camera UVs unchanged.
    vec3 composited = camera.rgb + max(vec3(0.0), vec3(1.0) - camera.rgb) * light;
    fragColor = TDOutputSwizzle(preview ? vec4(composited, camera.a) : vec4(light, 1.0));
#endif
}
