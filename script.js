// Initialize Leaflet map, centered on Nigeria
var map = L.map('map', {
    center: [9.0820, 8.6753], // Center of Nigeria
    zoom: 6,
    zoomControl: true,
    scrollWheelZoom: true
});

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
}).addTo(map);

// Initialize cluster group
var clusterLayer = L.markerClusterGroup();

// Load GeoJSON data
fetch('data/wema.json')
    .then(response => response.json())
    .then(data => {
        // Layer styles by category
        const styles = {
            publication: { color: '#ff7800', radius: 8 },
            event: { color: '#00ff00', radius: 10 },
            vendor: { color: '#0000ff', radius: 8 },
            service: { color: '#ff00ff', radius: 8 },
            waste: { color: '#FF00FF', radius: 8 },
            trending: { color: '#000000', radius: 8 }
        };

        // Add GeoJSON layer
        var dataLayer = L.geoJSON(data, {
            pointToLayer: function(feature, latlng) {
                return L.circleMarker([latlng.lat, latlng.lng], {
                    radius: styles[feature.properties.category].radius,
                    fillColor: styles[feature.properties.category].color,
                    color: '#000',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                });
            },
            onEachFeature: function(feature, layer) {
                layer.bindPopup(`
                    <b>${feature.properties.title}</b><br>
                    ${feature.properties.description}<br>
                    ${feature.properties.link ? `<a href="${feature.properties.link}" target="_blank">Read More</a>` : ''}
                    ${feature.properties.date ? `<br>Date: ${feature.properties.date}` : ''}
                `);
            }
        });

        // Add dataLayer to clusterLayer and then to map
        clusterLayer.addLayer(dataLayer);
        map.addLayer(clusterLayer);

        // Fit map to data bounds
        map.fitBounds(dataLayer.getBounds());

        // Filter by category
        document.getElementById('categoryFilter').addEventListener('change', function(e) {
            const category = e.target.value;
            clusterLayer.clearLayers(); // Clear cluster layer
            dataLayer.clearLayers(); // Clear data layer
            dataLayer.addData(data.features.filter(feature => 
                category === 'all' || feature.properties.category === category
            ));
            clusterLayer.addLayer(dataLayer); // Re-add to cluster
        });

        // Keyword search
        document.getElementById('search').addEventListener('input', function(e) {
            const keyword = e.target.value.toLowerCase();
            clusterLayer.clearLayers();
            dataLayer.clearLayers();
            dataLayer.addData(data.features.filter(feature => 
                feature.properties.title.toLowerCase().includes(keyword) ||
                feature.properties.description.toLowerCase().includes(keyword)
            ));
            clusterLayer.addLayer(dataLayer);
        });

        // Proximity analysis: Find vendors near events
        document.getElementById('proximityBtn').addEventListener('click', function() {
            const eventFeatures = data.features.filter(f => f.properties.category === 'event');
            const vendorFeatures = data.features.filter(f => f.properties.category === 'vendor');
            const radius = 50000; // 50 km in meters

            // Clear existing layers
            clusterLayer.clearLayers();
            dataLayer.clearLayers();
            dataLayer.addData(data.features);
            clusterLayer.addLayer(dataLayer);

            // Add proximity buffers
            eventFeatures.forEach(event => {
                const eventPoint = turf.point(event.geometry.coordinates);
                const buffer = turf.buffer(eventPoint, radius / 1000, { units: 'kilometers' });
                L.geoJSON(buffer, {
                    style: { color: '#ff0000', weight: 2, fillOpacity: 0.1 }
                }).addTo(map);

                // Highlight nearby vendors
                vendorFeatures.forEach(vendor => {
                    const vendorPoint = turf.point(vendor.geometry.coordinates);
                    if (turf.booleanPointInPolygon(vendorPoint, buffer)) {
                        L.circleMarker([vendor.geometry.coordinates[1], vendor.geometry.coordinates[0]], {
                            radius: 10,
                            fillColor: '#ff0000',
                            color: '#000',
                            weight: 2,
                            fillOpacity: 0.9
                        }).addTo(map).bindPopup(`<b>Nearby Vendor: ${vendor.properties.title}</b>`);
                    }
                });
            });
        });
    })
    .catch(error => console.error('Error loading GeoJSON:', error));

// Optimize for mobile: Adjust zoom control position
if (window.innerWidth <= 576) {
    map.zoomControl.setPosition('topright');
}