const photos = [
  { src: "/images/bw-01.jpg", w: 1600, h: 900 },
  { src: "/images/bw-02.jpg", w: 1600, h: 900 },
  { src: "/images/bw-03.jpg", w: 1600, h: 1066 },
  { src: "/images/bw-04.jpg", w: 1600, h: 900 },
  { src: "/images/bw-05.jpg", w: 1280, h: 1280 },
  { src: "/images/bw-06.jpg", w: 900, h: 1600 },
];

export default function Home() {
  return (
    <main>
      <h1>fong-relay</h1>
      <p>
        <a href="https://limpaulfin.github.io/publications/">limpaulfin.github.io/publications</a>
      </p>
      <h2>Images</h2>
      <div style={{ display: "grid", gap: "1.25rem" }}>
        {photos.map((p, i) => (
          <figure key={p.src} style={{ margin: 0 }}>
            <img src={p.src} alt={`Photo ${i + 1}`} width={p.w} height={p.h} loading="lazy" decoding="async" style={{ width: "100%", maxWidth: p.h > p.w ? 420 : undefined, height: "auto", borderRadius: 8 }} />
            <figcaption style={{ fontSize: "0.9rem", color: "#555", marginTop: "0.4rem" }}>Photo {i + 1}</figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
