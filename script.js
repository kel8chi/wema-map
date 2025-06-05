// Initialize Leaflet map
var map = L.map('map', {
    center: [9.0820, 8.6753], // Default center (Nigeria)
    zoom: 6,
    zoomControl: true,
    scrollWheelZoom: true
});

// Define tile layers for light and dark themes
var lightTheme = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
});

var darkTheme = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors & © <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19
});

// Set default theme (light)
var currentTileLayer = lightTheme;
currentTileLayer.addTo(map);

// Initialize cluster group
var clusterLayer = L.markerClusterGroup();

// Fetch user's location using ipapi.co
function getUserLocation() {
    fetch('https://ipapi.co/json/')
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                console.error('Error fetching IP location:', data.reason);
                return;
            }
            const lat = data.latitude;
            const lon = data.longitude;
            // Center map on user's location
            map.setView([lat, lon], 10);
            // Add a marker for user's location
            L.marker([lat, lon])
                .addTo(map)
                .bindPopup('Your Location')
                .openPopup();
        })
        .catch(error => {
            console.error('Error fetching user location:', error);
        });
}

// Call getUserLocation when the map loads
getUserLocation();

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
            clusterLayer.clearLayers();
            dataLayer.clearLayers();
            dataLayer.addData(data.features.filter(feature => 
                category === 'all' || feature.properties.category === category
            ));
            clusterLayer.addLayer(dataLayer);
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

// Theme toggle functionality
document.getElementById('themeToggle').addEventListener('click', function() {
    const isDark = document.body.classList.contains('dark-theme');
    if (isDark) {
        // Switch to light theme
        map.removeLayer(currentTileLayer);
        currentTileLayer = lightTheme;
        currentTileLayer.addTo(map);
        document.body.classList.remove('dark-theme');
        document.getElementById('themeToggle').textContent = 'Switch to Dark Theme';
    } else {
        // Switch to dark theme
        map.removeLayer(currentTileLayer);
        currentTileLayer = darkTheme;
        currentTileLayer.addTo(map);
        document.body.classList.add('dark-theme');
        document.getElementById('themeToggle').textContent = 'Switch to Light Theme';
    }
});

// Optimize for mobile: Adjust zoom control position
if (window.innerWidth <= 576) {
    map.zoomControl.setPosition('topright');
}