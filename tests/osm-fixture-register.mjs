// Synthetic responses used ONLY by the isolated smoke test, never by production.
if (
  process.env.NEXTECH_OSM_FIXTURE !== "true" ||
  !process.env.DATABASE_PATH?.includes("free-test-")
)
  throw Error("Fixture requires isolated test database");
const original = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (
    !String(url).startsWith("https://maps.mail.ru/osm/tools/overpass/api/interpreter?")
  )
    return original(url, options);
  return Response.json({
    elements: [
      { type: "area", id: 3600000001 },
      {
        type: "node",
        id: 1001,
        lat: -22.2,
        lon: -54.8,
        tags: {
          name: "Fixture A",
          shop: "convenience",
          "addr:street": "Rua Teste A",
          phone: "+5567998765432",
          "contact:whatsapp": "+5567998765432",
        },
      },
      {
        type: "node",
        id: 1002,
        lat: -22.3,
        lon: -54.9,
        tags: {
          name: "Fixture B",
          shop: "convenience",
          "addr:street": "Rua Teste B",
          phone: "+5567997654321",
        },
      },
    ],
  });
};
