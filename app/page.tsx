const photos = [
  { src: "/images/issd-2026-money-follows-trust.jpg", w: 1600, h: 900, alt: "Báo cáo tại hội thảo ISSD 2026, RMIT University: slide \"Money follows trust\"", cap: "ISSD 2026, RMIT University: Money follows trust" },
  { src: "/images/issd-2026-coverage-is-not-depth.jpg", w: 1600, h: 1066, alt: "Báo cáo tại hội thảo ISSD 2026, RMIT University: slide \"Coverage is not depth\"", cap: "ISSD 2026, RMIT University: Coverage is not depth" },
  { src: "/images/issd-2026-problem-opening.jpg", w: 1600, h: 900, alt: "Báo cáo tại hội thảo ISSD 2026, RMIT University: phần mở đầu \"Problem\"", cap: "ISSD 2026, RMIT University: phần mở đầu" },
];

export default function Home() {
  return (
    <main>
      <h1>fong-relay</h1>
      <p>
        Trang chính của tác giả:{" "}
        <a href="https://limpaulfin.github.io/publications/">limpaulfin.github.io/publications</a>
      </p>
      <h2>Hình ảnh</h2>
      <div style={{ display: "grid", gap: "1.25rem" }}>
        {photos.map((p) => (
          <figure key={p.src} style={{ margin: 0 }}>
            <img src={p.src} alt={p.alt} width={p.w} height={p.h} loading="lazy" decoding="async" style={{ width: "100%", height: "auto", borderRadius: 8 }} />
            <figcaption style={{ fontSize: "0.9rem", color: "#555", marginTop: "0.4rem" }}>{p.cap}</figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
