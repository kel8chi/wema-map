document.addEventListener('DOMContentLoaded', () => {
    class MapManager {
        constructor() {
            // Map configuration
            this.map = null;
            this.dataLayer = null;
            this.geojsonData = { features: [] };
            this.selectedCategory = 'all';
            this.defaultCenter = [9.0820, 8.6753]; // Nigeria
            this.defaultZoom = 6;

            // Style definitions for categories
            this.styles = {
                publication: { color: '#ff7800', label: 'Publication' },
                event: { color: '#00ff00', label: 'Event' },
                vendor: { color: '#0000ff', label: 'Vendor' },
                service: { color: '#ff00ff', label: 'Service' },
                waste: { color: '#800080', label: 'Waste' },
                trending: { color: '#ff0000', label: 'Trending' },
            };
        }

        // Initialize the Leaflet map
        initializeMap() {
            const mapElement = document.getElementById('map');
            if (!mapElement) {
                this.showError('Map container not found.');
                return false;
            }
            try {
                this.map = L.map('map', {
                    center: this.defaultCenter,
                    zoom: this.defaultZoom,
                    zoomControl: true,
                });
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                    maxZoom: 18,
                }).addTo(this.map);
                return true;
            } catch (error) {
                this.showError('Failed to initialize map.');
                console.error('Map initialization error:', error);
                return false;
            }
        }

        // Fetch GeoJSON data
        async fetchGeoJson() {
            try {
                const response = await fetch('data/wema.json');
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                this.geojsonData = await response.json();
                if (!this.geojsonData.features?.length) {
                    throw new Error('GeoJSON data is empty or invalid.');
                }
                console.log(`Loaded ${this.geojsonData.features.length} GeoJSON features`);
            } catch (error) {
                this.showError('Failed to load GeoJSON data. Check data/wema.json.');
                console.error('GeoJSON fetch error:', error);
                throw error;
            }
        }

        // Load GeoJSON data onto the map
        loadGeoJson() {
            if (!this.geojsonData.features.length) {
                this.showError('No GeoJSON data available.');
                return;
            }
            try {
                // Remove existing layer if present
                if (this.dataLayer) {
                    this.map.removeLayer(this.dataLayer);
                }
                this.dataLayer = L.geoJSON(this.geojsonData, {
                    pointToLayer: (feature, latlng) => {
                        const category = feature.properties?.category || 'publication';
                        const [lon, lat] = feature.geometry.coordinates;
                        if (isNaN(lat) || isNaN(lon)) {
                            console.warn(`Invalid coordinates for feature: ${feature.properties?.title || 'Unnamed'}`);
                            return null;
                        }
                        return L.circleMarker(latlng, {
                            radius: 8,
                            fillColor: this.styles[category]?.color || '#ff7800',
                            color: '#000',
                            weight: 1,
                            opacity: 1,
                            fillOpacity: 0.8,
                        });
                    },
                    filter: (feature) => {
                        const isValid = feature.geometry?.type === 'Point' &&
                            Array.isArray(feature.geometry.coordinates) &&
                            feature.geometry.coordinates.length === 2 &&
                            !isNaN(feature.geometry.coordinates[0]) &&
                            !isNaN(feature.geometry.coordinates[1]);
                        if (!isValid) {
                            console.warn(`Filtered out invalid feature: ${feature.properties?.title || 'Unnamed'}`);
                        }
                        return isValid && (this.selectedCategory === 'all' || feature.properties?.category === this.selectedCategory);
                    },
                    onEachFeature: (feature, layer) => {
                        if (layer) {
                            const category = feature.properties?.category || 'unknown';
                            layer.bindPopup(this.createPopupContent(feature, category));
                        }
                    },
                }).addTo(this.map);
                // Fit map to bounds if valid
                const bounds = this.dataLayer.getBounds();
                if (bounds.isValid()) {
                    this.map.fitBounds(bounds, { padding: [50, 50] });
                }
            } catch (error) {
                this.showError('Failed to load map data.');
                console.error('GeoJSON load error:', error);
            }
        }

        // Create popup content for a feature
        createPopupContent(feature, category) {
            const props = feature.properties;
            return `
                <strong>${props.title || 'Untitled'}</strong><br>
                ${props.description || 'No description'}<br>
                Category: ${this.styles[category]?.label || 'Unknown'}<br>
                ${props.link ? `<a href="${props.link}" target="_blank" rel="noopener" class="link-primary">Link</a>` : ''}
                ${props.date ? `<br>Date: ${props.date}` : ''}
            `;
        }

        // Initialize sidebar interactions
        initializeInteractions() {
            const elements = {
                toggleSidebar: document.getElementById('toggleSidebar'),
                sidebarContent: document.getElementById('sidebarContent'),
                categoryFilter: document.getElementById('categoryFilter'),
                themeSelect: document.getElementById('themeSelect'),
            };

            if (Object.values(elements).some(el => !el)) {
                this.showError('Failed to initialize controls.');
                console.error('Missing DOM elements:', elements);
                return;
            }

            // Sidebar toggle
            elements.toggleSidebar.addEventListener('click', () => {
                const bsCollapse = new bootstrap.Collapse(elements.sidebarContent, { toggle: true });
                const isVisible = elements.sidebarContent.classList.contains('show');
                elements.toggleSidebar.setAttribute('aria-expanded', isVisible);
                elements.toggleSidebar.querySelector('i').className = isVisible ? 'bi bi-x' : 'bi bi-list';
            });

            // Category filter
            elements.categoryFilter.addEventListener('change', (e) => {
                this.selectedCategory = e.target.value;
                console.log('Selected category:', this.selectedCategory);
                this.loadGeoJson(); // Reload layer with filter
            });

            // Theme switcher
            elements.themeSelect.addEventListener('change', (e) => {
                document.body.className = `${e.target.value}-theme`;
                console.log('Theme changed to:', e.target.value);
            });
        }

        // Display error message
        showError(message) {
            const errorDiv = document.getElementById('errorMessage');
            if (errorDiv) {
                errorDiv.textContent = message;
                errorDiv.style.display = 'block';
                setTimeout(() => errorDiv.style.display = 'none', 5000);
            }
        }

        // Start the application
        async start() {
            if (!this.initializeMap()) {
                return;
            }
            try {
                await this.fetchGeoJson();
                this.loadGeoJson();
                this.initializeInteractions();
                console.log('MapManager initialized successfully');
            } catch (error) {
                console.error('MapManager startup failed:', error);
            }
        }
    }

    // Initialize and start the map
    const mapManager = new MapManager();
    mapManager.start();
});