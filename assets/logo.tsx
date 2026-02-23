const Logo = () => {
  const V = [
    [1,0,0,1],
    [1,0,0,1],
    [0,1,1,0],
    [0,1,0,0],
  ];

  const Grid = ({ size, gap, radius, lit, unlit, style }) => {
    const cell = (size - gap * 3) / 4;
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={style}>
        {V.map((row, r) =>
          row.map((on, c) => (
            <rect
              key={`${r}-${c}`}
              x={c * (cell + gap)}
              y={r * (cell + gap)}
              width={cell}
              height={cell}
              rx={radius}
              fill={on ? lit : unlit}
            />
          ))
        )}
      </svg>
    );
  };

  return (
    <div style={{ background: "#f5f5f5", minHeight: "100vh", padding: "40px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>

        {/* Hero — main logo */}
        <div style={{ marginBottom: 50, padding: "50px", background: "#fff", borderRadius: 16, border: "1px solid #e0e0e0", textAlign: "center" }}>
          <p style={{ color: "#bbb", fontSize: 11, marginBottom: 30, letterSpacing: "0.1em" }}>PRIMARY LOGO</p>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 18 }}>
            <Grid size={52} gap={3} radius={3} lit="#10b981" unlit="#e0e0e0" />
            <span style={{ fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace", fontSize: 44, fontWeight: 700, color: "#1a1a1a", letterSpacing: "-0.02em" }}>vram<span style={{ color: "#10b981" }}>.run</span></span>
          </div>
        </div>

        {/* Variations row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 50 }}>

          {/* On dark */}
          <div style={{ padding: "40px", background: "#0f0f0f", borderRadius: 12, textAlign: "center" }}>
            <p style={{ color: "#555", fontSize: 11, marginBottom: 24, letterSpacing: "0.1em" }}>ON DARK</p>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
              <Grid size={42} gap={2.5} radius={2.5} lit="#10b981" unlit="#2a2a2a" />
              <span style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 34, fontWeight: 700, color: "#f0f0f0", letterSpacing: "-0.02em" }}>vram<span style={{ color: "#10b981" }}>.run</span></span>
            </div>
          </div>

          {/* Compact / nav */}
          <div style={{ padding: "40px", background: "#fff", borderRadius: 12, border: "1px solid #e0e0e0", textAlign: "center" }}>
            <p style={{ color: "#bbb", fontSize: 11, marginBottom: 24, letterSpacing: "0.1em" }}>NAV SIZE</p>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              <Grid size={28} gap={2} radius={2} lit="#10b981" unlit="#e0e0e0" />
              <span style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 22, fontWeight: 700, color: "#1a1a1a", letterSpacing: "-0.02em" }}>vram<span style={{ color: "#10b981" }}>.run</span></span>
            </div>
          </div>
        </div>

        {/* Icon only — different sizes */}
        <div style={{ marginBottom: 50, padding: "40px", background: "#fff", borderRadius: 12, border: "1px solid #e0e0e0" }}>
          <p style={{ color: "#bbb", fontSize: 11, marginBottom: 24, letterSpacing: "0.1em" }}>ICON ONLY — FAVICON / APP ICON / SOCIAL</p>
          <div style={{ display: "flex", gap: 40, alignItems: "end", justifyContent: "center" }}>
            
            {/* 16px favicon */}
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 16, height: 16, display: "inline-block" }}>
                <Grid size={16} gap={1} radius={1} lit="#10b981" unlit="#ddd" />
              </div>
              <p style={{ color: "#bbb", fontSize: 10, marginTop: 8 }}>16px</p>
            </div>

            {/* 32px */}
            <div style={{ textAlign: "center" }}>
              <Grid size={32} gap={2} radius={2} lit="#10b981" unlit="#e0e0e0" />
              <p style={{ color: "#bbb", fontSize: 10, marginTop: 8 }}>32px</p>
            </div>

            {/* 64px */}
            <div style={{ textAlign: "center" }}>
              <Grid size={64} gap={3.5} radius={3} lit="#10b981" unlit="#e0e0e0" />
              <p style={{ color: "#bbb", fontSize: 10, marginTop: 8 }}>64px</p>
            </div>

            {/* 128px — social avatar */}
            <div style={{ textAlign: "center" }}>
              <Grid size={128} gap={6} radius={5} lit="#10b981" unlit="#e8e8e8" />
              <p style={{ color: "#bbb", fontSize: 10, marginTop: 8 }}>128px</p>
            </div>
          </div>
        </div>

        {/* Social avatar with background */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20, marginBottom: 50 }}>
          <div style={{ padding: "30px", background: "#fff", borderRadius: 12, border: "1px solid #e0e0e0", textAlign: "center" }}>
            <p style={{ color: "#bbb", fontSize: 11, marginBottom: 16, letterSpacing: "0.1em" }}>GITHUB / SOCIAL</p>
            <div style={{ width: 80, height: 80, background: "#0f0f0f", borderRadius: 16, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Grid size={52} gap={3} radius={3} lit="#10b981" unlit="#2a2a2a" />
            </div>
          </div>
          <div style={{ padding: "30px", background: "#fff", borderRadius: 12, border: "1px solid #e0e0e0", textAlign: "center" }}>
            <p style={{ color: "#bbb", fontSize: 11, marginBottom: 16, letterSpacing: "0.1em" }}>WHITE BG</p>
            <div style={{ width: 80, height: 80, background: "#fff", borderRadius: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid #eee" }}>
              <Grid size={52} gap={3} radius={3} lit="#10b981" unlit="#e8e8e8" />
            </div>
          </div>
          <div style={{ padding: "30px", background: "#fff", borderRadius: 12, border: "1px solid #e0e0e0", textAlign: "center" }}>
            <p style={{ color: "#bbb", fontSize: 11, marginBottom: 16, letterSpacing: "0.1em" }}>GREEN BG</p>
            <div style={{ width: 80, height: 80, background: "#10b981", borderRadius: 16, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
              <Grid size={52} gap={3} radius={3} lit="#fff" unlit="rgba(0,0,0,0.15)" />
            </div>
          </div>
        </div>

        {/* Color spec */}
        <div style={{ padding: "30px 40px", background: "#fff", borderRadius: 12, border: "1px solid #e0e0e0" }}>
          <p style={{ color: "#bbb", fontSize: 11, marginBottom: 16, letterSpacing: "0.1em" }}>SPECS</p>
          <div style={{ display: "flex", gap: 40, fontSize: 13, color: "#666", fontFamily: "monospace" }}>
            <div>
              <div style={{ width: 24, height: 24, background: "#10b981", borderRadius: 4, marginBottom: 6 }}/>
              #10b981
            </div>
            <div>
              <div style={{ width: 24, height: 24, background: "#1a1a1a", borderRadius: 4, marginBottom: 6 }}/>
              #1a1a1a
            </div>
            <div>
              <div style={{ width: 24, height: 24, background: "#e0e0e0", borderRadius: 4, marginBottom: 6, border: "1px solid #ccc" }}/>
              #e0e0e0
            </div>
            <div style={{ color: "#999", alignSelf: "end" }}>
              font: monospace, 700
            </div>
          </div>
          <p style={{ color: "#aaa", fontSize: 12, marginTop: 16 }}>Grid pattern: 4×4, V shape at positions (0,0)(0,3)(1,0)(1,3)(2,1)(2,2)(3,1). Cells are square with small gap and border radius.</p>
        </div>
      </div>
    </div>
  );
};

export default Logo;
