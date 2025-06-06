class MapManager {
    constructor() {
        this.API_URL = 'https://wema-map.onrender.com/api/events';
        this.DEFAULT_COORDS = { lat: 9.0820, lon: 8.6753 };
        this.SEARCH_RADIUS_KM = 50;
        this.map = null;
        this.clusterLayer = L.markerClusterGroup();
        this.dataLayer = null;
        this.geojsonData = null;
        this.currentTileLayer = null;
        this.token = null;
        this.isAdmin = false;
        this.socket = io('https://wema-map.onrender.com');
        this.styles = {
            publication: { color: '#ff7800' },
            event: { color: '#00ff00' },
            vendor: { color: '#0000ff' },
            service: { color: '#ff00ff' },
            waste: { color: '#FF00FF' },
            trending: { color: '#000000' },
        };
        this.tileLayers = {
            light: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                maxZoom: 19,
            }),
            dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors & © <a href="https://carto.com/attributions">CARTO</a>',
                maxZoom: 19,
            }),
        };
        this.gpsIcon = L.icon({
            iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.3/images/marker-icon.png',
            iconSize: [25, 41],
            iconAnchor: [12, 41],
            popupAnchor: [1, -34],
            shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.3/images/marker-shadow.png',
            shadowSize: [41, 41],
        });
        this.geocodeCache = new Map();
    }

    initializeMap() {
        this.map = L.map('map', {
            center: [this.DEFAULT_COORDS.lat, this.DEFAULT_COORDS.lon],
            zoom: 6,
            zoomControl: true,
            scrollWheelZoom: true,
        });
        this.currentTileLayer = this.tileLayers.light;
        this.currentTileLayer.addTo(this.map);
        this.adjustZoomControl();
        window.addEventListener('resize', () => this.adjustZoomControl());
    }

    adjustZoomControl() {
        this.map.zoomControl.setPosition(window.innerWidth <= 576 ? 'topright' : 'topleft');
    }

    async geocodeLocation(location) {
        if (this.geocodeCache.has(location)) return this.geocodeCache.get(location);

        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`;
        try {
            const response = await fetch(url, { headers: { 'User-Agent': 'WebMap1/1.0' } });
            const data = await response.json();
            if (data.length === 0) {
                this.showToast('Location not found.', 'danger');
                return null;
            }
            const coords = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
            this.geocodeCache.set(location, coords);
            return coords;
        } catch (error) {
            console.error('Error geocoding location:', error);
            this.showToast('Error geocoding location. Please try again.', 'danger');
            return null;
        }
    }

    parseQuery(query) {
        const lowerQuery = query.toLowerCase();
        const categories = ['publication', 'event', 'vendor', 'service', 'waste', 'trending'];
        let category = null;
        let location = null;
        let keyword = null;

        for (const cat of categories) {
            if (lowerQuery.includes(cat)) {
                category = cat;
                break;
            }
        }

        const locationMatch = lowerQuery.match(/near\s+([a-z\s]+)/i);
        if (locationMatch) location = locationMatch[1].trim();

        keyword = lowerQuery
            .replace(/near\s+[a-z\s]+/i, '')
            .replace(new RegExp(categories.join('|'), 'i'), '')
            .trim();

        return { category, location, keyword };
    }

    async processAIQuery(query) {
        if (!this.geojsonData) return this.showToast('No data loaded.', 'warning');
        const { category, location, keyword } = this.parseQuery(query);
        this.clusterLayer.clearLayers();
        this.dataLayer.clearLayers();

        let filteredFeatures = this.geojsonData.features;

        if (category) {
            filteredFeatures = filteredFeatures.filter(f => f.properties.category === category);
        }

        if (keyword) {
            filteredFeatures = filteredFeatures.filter(f =>
                f.properties.title.toLowerCase().includes(keyword) ||
                f.properties.description.toLowerCase().includes(keyword)
            );
        }

        filteredFeatures = await this.filterByLocation(filteredFeatures, location);

        this.dataLayer.addData(filteredFeatures);
        this.clusterLayer.addLayer(this.dataLayer);
        this.showToast(`Found ${filteredFeatures.length} results for "${query}"`, 'info');
    }

    async filterByLocation(features, location) {
        if (!location) return features;
        const coords = await this.geocodeLocation(location);
        if (!coords) return features;

        const centerPoint = turf.point([coords.lon, coords.lat]);
        const buffer = turf.buffer(centerPoint, this.SEARCH_RADIUS_KM, { units: 'kilometers' });
        this.map.setView([coords.lat, coords.lon], 10);
        return features.filter(f => {
            const featurePoint = turf.point(f.geometry.coordinates);
            return turf.booleanPointInPolygon(featurePoint, buffer);
        });
    }

    async loadGeoJSON(userCoords) {
        try {
            const response = await fetch(this.API_URL, {
                headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
            });
            if (!response.ok) throw new Error('Failed to fetch GeoJSON');
            this.geojsonData = await response.json();
            localStorage.setItem('geojsonData', JSON.stringify(this.geojsonData));

            this.dataLayer = L.geoJSON(this.geojsonData, {
                pointToLayer: (feature, latlng) => L.marker(latlng, { icon: this.gpsIcon }),
                onEachFeature: (feature, layer) => {
                    layer.bindPopup(`
                        <b>${feature.properties.title}</b><br>
                        ${feature.properties.description}<br>
                        ${feature.properties.link ? `<a href="${feature.properties.link}" target="_blank">Read More</a>` : ''}
                        ${feature.properties.date ? `<br>Date: ${feature.properties.date}` : ''}
                    `);
                },
            });

            this.clusterLayer.addLayer(this.dataLayer);
            this.map.addLayer(this.clusterLayer);
            this.map.fitBounds(this.dataLayer.getBounds());

            await this.recommendNearest(userCoords);
        } catch (error) {
            console.error('Error loading GeoJSON:', error);
            this.showToast('Failed to load map data.', 'danger');
        }
    }

    async recommendNearest(userCoords) {
        if (!this.geojsonData) return;
        const targetCategories = ['event', 'trending', 'waste'];
        const userPoint = turf.point([userCoords.lon, userCoords.lat]);
        let nearestFeature = null;
        let minDistance = Infinity;

        this.geojsonData.features.forEach(feature => {
            if (targetCategories.includes(feature.properties.category)) {
                const featurePoint = turf.point(feature.geometry.coordinates);
                const distance = turf.distance(userPoint, featurePoint, { units: 'kilometers' });
                if (distance < minDistance) {
                    minDistance = distance;
                    nearestFeature = feature;
                }
            }
        });

        const recommendationDiv = document.getElementById('recommendation');
        const recommendationText = document.getElementById('recommendationText');
        if (nearestFeature) {
            recommendationText.innerHTML = `
                <b>Recommended: ${nearestFeature.properties.title}</b><br>
                Category: ${nearestFeature.properties.category}<br>
                ${nearestFeature.properties.description}<br>
                Distance: ${minDistance.toFixed(2)} km<br>
                ${nearestFeature.properties.link ? `<a href="${nearestFeature.properties.link}" target="_blank">Read More</a>` : ''}
                ${nearestFeature.properties.date ? `<br>Date: ${nearestFeature.properties.date}` : ''}
            `;
            recommendationDiv.style.display = 'block';
            this.map.setView([nearestFeature.geometry.coordinates[1], nearestFeature.geometry.coordinates[0]], 12);
        } else {
            recommendationText.textContent = 'No events, trending items, or waste disposal sites found nearby.';
            recommendationDiv.style.display = 'block';
        }
    }

    async getUserLocation() {
        try {
            if (navigator.geolocation) {
                const position = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject);
                });
                return { lat: position.coords.latitude, lon: position.coords.longitude };
            }
            throw new Error('Geolocation not supported');
        } catch {
            try {
                const response = await fetch('https://ipapi.co/json/');
                const data = await response.json();
                return { lat: data.latitude, lon: data.longitude };
            } catch (error) {
                console.error('Error fetching user location:', error);
                this.showToast('Unable to detect location. Using default.', 'warning');
                return this.DEFAULT_COORDS;
            }
        }
    }

    async login(event) {
        event.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        try {
            const response = await fetch('https://wema-map.onrender.com/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const data = await response.json();
            if (response.ok) {
                this.token = data.token;
                this.isAdmin = data.role === 'admin';
                document.getElementById('loginForm').style.display = 'none';
                document.getElementById('addEventOption').style.display = this.isAdmin ? 'block' : 'none';
                document.getElementById('addEventSection').style.display = this.isAdmin ? 'block' : 'none';
                this.showToast('Login successful!', 'success');
            } else {
                this.showToast(data.error, 'danger');
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showToast('Error logging in.', 'danger');
        }
    }

    async addEvent(event) {
        event.preventDefault();
        const formData = {
            title: document.getElementById('eventTitle').value,
            category: document.getElementById('eventCategory').value,
            description: document.getElementById('eventDescription').value,
            link: document.getElementById('eventLink').value,
            date: document.getElementById('eventDate').value,
            location: document.getElementById('eventLocation').value,
        };

        const coords = await this.geocodeLocation(formData.location);
        if (!coords) return;

        try {
            const response = await fetch(this.API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.token}`,
                },
                body: JSON.stringify({ ...formData, latitude: coords.lat, longitude: coords.lon }),
            });
            if (response.ok) {
                this.showToast('Event added successfully!', 'success');
                document.getElementById('addEventForm').reset();
            } else {
                this.showToast('Error adding event.', 'danger');
            }
        } catch (error) {
            console.error('Error adding event:', error);
            this.showToast('Error adding event.', 'danger');
        }
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    filterByCategory(category) {
        if (category === 'add-event' && this.isAdmin) {
            document.getElementById('addEventSection').style.display = 'block';
            document.getElementById('categoryFilter').value = 'all';
            return;
        }
        this.clusterLayer.clearLayers();
        this.dataLayer.clearLayers();
        const filteredData = this.geojsonData.features.filter(feature =>
            category === 'all' || feature.properties.category === category
        );
        this.dataLayer.addData(filteredData);
        this.clusterLayer.addLayer(this.dataLayer);
    }

    searchByKeyword(keyword) {
        this.clusterLayer.clearLayers();
        this.dataLayer.clearLayers();
        const filteredData = this.geojsonData.features.filter(feature =>
            feature.properties.title.toLowerCase().includes(keyword.toLowerCase()) ||
            feature.properties.description.toLowerCase().includes(keyword.toLowerCase())
        );
        this.dataLayer.addData(filteredData);
        this.clusterLayer.addLayer(this.dataLayer);
    }

    proximityAnalysis() {
        if (!this.geojsonData) return this.showToast('No data loaded.', 'warning');
        const eventFeatures = this.geojsonData.features.filter(f => f.properties.category === 'event');
        const vendorFeatures = this.geojsonData.features.filter(f => f.properties.category === 'vendor');

        this.clusterLayer.clearLayers();
        this.dataLayer.clearLayers();
        this.dataLayer.addData(this.geojsonData.features);
        this.clusterLayer.addLayer(this.dataLayer);

        eventFeatures.forEach(event => {
            const eventPoint = turf.point(event.geometry.coordinates);
            const buffer = turf.buffer(eventPoint, this.SEARCH_RADIUS_KM, { units: 'kilometers' });
            L.geoJSON(buffer, {
                style: { color: '#ff0000', weight: 2, fillOpacity: 0.1 },
            }).addTo(this.map);

            vendorFeatures.forEach(vendor => {
                const vendorPoint = turf.point(vendor.geometry.coordinates);
                if (turf.booleanPointInPolygon(vendorPoint, buffer)) {
                    L.marker([vendor.geometry.coordinates[1], vendor.geometry.coordinates[0]], {
                        icon: this.gpsIcon,
                    })
                        .addTo(this.map)
                        .bindPopup(`<b>Nearby Vendor: ${vendor.properties.title}</b>`);
                }
            });
        });
    }

    toggleTheme() {
        const isDark = document.body.classList.contains('dark-theme');
        this.map.removeLayer(this.currentTileLayer);
        this.currentTileLayer = isDark ? this.tileLayers.light : this.tileLayers.dark;
        this.currentTileLayer.addTo(this.map);
        document.body.classList.toggle('dark-theme');
        document.getElementById('themeToggle').textContent = isDark ? 'Switch to Dark Theme' : 'Switch to Light Theme';
    }

    showToast(message, type) {
        const toastContainer = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast align-items-center text-white bg-${type} border-0`;
        toast.setAttribute('role', 'alert');
        toast.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
        `;
        toastContainer.appendChild(toast);
        new bootstrap.Toast(toast).show();
        setTimeout(() => toast.remove(), 5000);
    }

    initializeEventListeners() {
        document.getElementById('toggleSidebar').addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            sidebar.classList.toggle('collapsed');
            document.getElementById('toggleSidebar').textContent = sidebar.classList.contains('collapsed')
                ? 'Expand Sidebar'
                : 'Collapse Sidebar';
        });

        document.getElementById('categoryFilter').addEventListener('change', e => this.filterByCategory(e.target.value));
        document.getElementById('search').addEventListener('input', this.debounce(e => this.searchByKeyword(e.target.value), 300));
        document.getElementById('aiQueryBtn').addEventListener('click', () => {
            const query = document.getElementById('aiQuery').value;
            if (query) this.processAIQuery(query);
        });
        document.getElementById('proximityBtn').addEventListener('click', () => this.proximityAnalysis());
        document.getElementById('themeToggle').addEventListener('click', () => this.toggleTheme());
        document.getElementById('addEventForm').addEventListener('submit', e => this.addEvent(e));
        document.getElementById('adminLoginForm').addEventListener('submit', e => this.login(e));

        this.socket.on('newEvent', async () => {
            this.showToast('New event added!', 'info');
            await this.loadGeoJSON(await this.getUserLocation());
        });

        if (typeof interact !== 'undefined') {
            interact('#sidebar').resizable({
                edges: { right: true },
                listeners: {
                    move(event) {
                        event.target.style.width = `${event.rect.width}px`;
                    },
                },
                modifiers: [
                    interact.modifiers.restrictSize({
                        min: { width: 200 },
                        max: { width: 600 },
                    }),
                ],
            });
        } else {
            console.warn('interact.js not loaded; sidebar resizing disabled.');
        }
    }

    async start() {
        this.initializeMap();
        const userCoords = await this.getUserLocation();
        await this.loadGeoJSON(userCoords);
        this.initializeEventListeners();
    }
}

const mapManager = new MapManager();
mapManager.start();