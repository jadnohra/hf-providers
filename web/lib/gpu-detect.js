// WebGL GPU detection + localStorage caching + Apple Silicon memory picker.

const STORAGE_KEY = 'my-gpu-key';
const DISMISS_KEY = 'my-gpu-dismissed';

export function isDismissed() {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
}

export function dismiss() {
  try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
}

export function undismiss() {
  try { localStorage.removeItem(DISMISS_KEY); } catch {}
}

export function clearStored() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

export function storeChoice(key) {
  try { localStorage.setItem(STORAGE_KEY, key); } catch {}
}

function getStored() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

// Main detection entry point. Returns one of:
//   { key, gpu }                        — single match, ready to use
//   { needsPicker: true, chip, variants: [{key, gpu}...] } — Apple Silicon, needs memory pick
//   null                                — detection failed or no match
export function detectGpu(hardware) {
  if (!hardware || !hardware.length) return null;

  // Check localStorage first
  const stored = getStored();
  if (stored) {
    const entry = hardware.find(([k]) => k === stored);
    if (entry) return { key: entry[0], gpu: entry[1] };
    // Stale key, clear it
    clearStored();
  }

  // WebGL detection
  const renderer = getWebGLRenderer();
  if (!renderer) return null;

  // Parse the renderer string
  const parsed = parseRenderer(renderer);
  if (!parsed) return null;

  if (parsed.apple) {
    return matchAppleSilicon(hardware, parsed.chip);
  } else {
    return matchDiscreteGpu(hardware, parsed.normalized);
  }
}

function getWebGLRenderer() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return null;

    // Try WEBGL_debug_renderer_info first (gives unmasked renderer)
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const unmasked = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
      if (unmasked) return unmasked;
    }

    // Fall back to basic renderer string
    return gl.getParameter(gl.RENDERER);
  } catch {
    return null;
  }
}

// Parse WebGL renderer string into a structured result.
// Returns { apple: true, chip: "m4_pro" } or { apple: false, normalized: "rtx_4090" } or null.
function parseRenderer(renderer) {
  if (!renderer) return null;
  let s = renderer.trim();

  // Safari returns "Apple GPU" with no chip info — can't detect
  if (/^Apple\s+GPU$/i.test(s)) return null;

  // Handle ANGLE wrapper (Chrome/Chromium).
  // Modern Chrome Metal:  "ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)"
  // Older Chrome OpenGL:  "ANGLE (Apple, Apple M4 Pro, OpenGL 4.1)"
  // Windows D3D11:        "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)"
  const angleMatch = s.match(/^ANGLE\s*\((.+)\)$/i);
  if (angleMatch) {
    const inner = angleMatch[1];
    // Split on top-level commas: "vendor, renderer_detail, version"
    const parts = inner.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      // Use the second part (renderer detail)
      s = parts[1];
      // Strip "ANGLE Metal Renderer: " prefix from Chrome Metal backend
      s = s.replace(/^ANGLE\s+Metal\s+Renderer:\s*/i, '');
    } else {
      s = inner;
    }
  }

  // Strip trailing API identifiers
  s = s.replace(/\s*(Direct3D\d*|OpenGL\s*[\d.]*|Vulkan|Metal|vs_\S+|ps_\S+).*$/gi, '').trim();
  // Strip PCI device ID in parens: "(0x00002204)"
  s = s.replace(/\s*\(0x[0-9a-f]+\)/gi, '').trim();

  // Apple Silicon: renderer is "Apple M4 Pro" or similar
  if (/^Apple\s+M\d/i.test(s)) {
    const chip = s.replace(/^Apple\s+/i, '')
      .toLowerCase()
      .replace(/\s+/g, '_');
    return { apple: true, chip };
  }

  // Discrete GPU: normalize for matching
  s = s.replace(/^(NVIDIA|AMD|ATI|Intel)\s+/i, '');
  s = s.replace(/^GeForce\s+/i, '');

  const normalized = s.toLowerCase()
    .replace(/[-\s]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  if (!normalized) return null;
  return { apple: false, normalized };
}

// Match Apple Silicon chip to hardware entries.
// Multiple memory configs may exist (e.g. m4_pro_24, m4_pro_48).
function matchAppleSilicon(hardware, chip) {
  // chip is like "m4_pro", keys are like "m4_pro_24", "m4_pro_48"
  // Also handle base chips: chip "m4" matches "m4_16", "m4_24", "m4_32"
  const variants = hardware.filter(([k]) => {
    // Key must start with chip prefix and then have a numeric suffix (memory size)
    if (!k.startsWith(chip)) return false;
    const rest = k.slice(chip.length);
    // Must be either exact match or _<digits>
    return rest === '' || /^_\d+$/.test(rest);
  });

  if (variants.length === 0) return null;
  if (variants.length === 1) {
    const [key, gpu] = variants[0];
    storeChoice(key);
    return { key, gpu };
  }

  // Multiple memory configs: need picker
  return {
    needsPicker: true,
    chip,
    variants: variants.map(([key, gpu]) => ({ key, gpu })),
  };
}

// Match a discrete GPU by normalized name against hardware DB.
function matchDiscreteGpu(hardware, normalized) {
  // Try exact key match first
  let match = hardware.find(([k]) => k === normalized);

  // Try substring match (e.g. "rtx_4090" in key)
  if (!match) {
    const candidates = hardware.filter(([k]) =>
      k.includes(normalized) || k.replace(/_/g, '').includes(normalized.replace(/_/g, ''))
    );
    // Prefer shortest key (most specific)
    if (candidates.length) {
      candidates.sort((a, b) => a[0].length - b[0].length);
      match = candidates[0];
    }
  }

  if (!match) return null;
  const [key, gpu] = match;
  storeChoice(key);
  return { key, gpu };
}
