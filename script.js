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
var dataLayer; // Global reference to GeoJSON layer
var geojsonData; // Store GeoJSON data globally

// Function to geocode location using Nominatim
async function geocodeLocation(location) {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`;
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'WebMap1/1.0' } });
        const data = await response.json();
        if (data.length > 0) {
            return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
        }
        return null;
    } catch (error) {
        console.error('Error geocoding location:', error);
        return null;
    }
}

// Simple query parser (replace with Hugging Face NLP in production)
function parseQuery(query) {
    const lowerQuery = query.toLowerCase();
    const categories = ['publication', 'event', 'vendor', 'service', 'waste', 'trending'];
    let category = null;
    let location = null;
    let keyword = null;

    // Detect category
    for (const cat of categories) {
        if (lowerQuery.includes(cat)) {
            category = cat;
            break;
        }
    }

    // Detect location (simple regex for "near [place]")
    const locationMatch = lowerQuery.match(/near\s+([a-z\s]+)/i);
    if (locationMatch) {
        location = locationMatch[1].trim();
    }

    // Detect keywords (remove category and location terms)
    keyword = lowerQuery
        .replace(/near\s+[a-z\s]+/i, '')
        .replace(categories.join('|'), '')
        .trim();

    return { category, location, keyword };
}

// Filter GeoJSON data based on parsed query
async function processAIQuery(query) {
    const { category, location, keyword } = parseQuery(query);
    clusterLayer.clearLayers();
    dataLayer.clearLayers();

    let filteredFeatures = geojsonData.features;

    // Filter by category
    if (category) {
        filteredFeatures = filteredFeatures.filter(f => f.properties.category === category);
    }

    // Filter by keyword
    if (keyword) {
        filteredFeatures = filteredFeatures.filter(f =>
            f.properties.title.toLowerCase().includes(keyword) ||
            f.properties.description.toLowerCase().includes(keyword)
        );
    }

    // Filter by location
    if (location) {
        const coords = await geocodeLocation(location);
        if (coords) {
            const radius = 50000; // 50km radius
            const centerPoint = turf.point([coords.lon, coords.lat]);
            const buffer = turf.buffer(centerPoint, radius / 1000, { units: 'kilometers' });

            filteredFeatures = filteredFeatures.filter(f => {
                const featurePoint = turf.point(f.geometry.coordinates);
                return turf.booleanPointInPolygon(featurePoint, buffer);
            });

            // Center map on location
            map.setView([coords.lat, coords.lon], 10);
        }
    }

    // Update map
    dataLayer.addData(filteredFeatures);
    clusterLayer.addLayer(dataLayer);

    // Display analytics
    const resultCount = filteredFeatures.length;
    alert(`Found ${resultCount} results for "${query}"`);
}

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
            map.setView([lat, lon], 10);
            L.marker([lat, lon]).addTo(map).bindPopup('Your Location').openPopup();
        })
        .catch(error => console.error('Error fetching user location:', error));
}

// Call getUserLocation when the map loads
getUserLocation();

// Load GeoJSON data
fetch('data/wema.json')
    .then(response => response.json())
    .then(data => {
        geojsonData = data; // Store data globally
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
        dataLayer = L.geoJSON(data, {
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

        // AI query search
        document.getElementById('aiQueryBtn').addEventListener('click', function() {
            const query = document.getElementById('aiQuery').value;
            if (query) {
                processAIQuery(query);
            }
        });

        // Proximity analysis: Find vendors near events
        document.getElementById('proximityBtn').addEventListener('click', function() {
            const eventFeatures = data.features.filter(f => f.properties.category === 'event');
            const vendorFeatures = data.features.filter(f => f.properties.category === 'vendor');
            const radius = 50000; // 50 km in meters

            clusterLayer.clearLayers();
            dataLayer.clearLayers();
            dataLayer.addData(data.features);
            clusterLayer.addLayer(dataLayer);

            eventFeatures.forEach(event => {
                const eventPoint = turf.point(event.geometry.coordinates);
                const buffer = turf.buffer(eventPoint, radius / 1000, { units: 'kilometers' });
                L.geoJSON(buffer, {
                    style: { color: '#ff0000', weight: 2, fillOpacity: 0.1 }
                }).addTo(map);

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
        map.removeLayer(currentTileLayer);
        currentTileLayer = lightTheme;
        currentTileLayer.addTo(map);
        document.body.classList.remove('dark-theme');
        document.getElementById('themeToggle').textContent = 'Switch to Dark Theme';
    } else {
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