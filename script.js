document.addEventListener('DOMContentLoaded', () => {
    class MapManager {
        constructor() {
            this.map = null;
            this.dataLayer = null;
            this.geojsonData = { features: [] };
            this.selectedCategory = 'all';
            this.defaultCenter = [9.0820, 8.6753]; // Nigeria center
            this.defaultZoom = 6;

            this.styles = {
                publication: { color: '#ff7800', label: 'Publication' },
                event: { color: '#00ff00', label: 'Event' },
                vendor: { color: '#0000ff', label: 'Vendor' },
                service: { color: '#ff00ff', label: 'Service' },
                waste: { color: '#800080', label: 'Waste' },
                trending: { color: '#ff0000', label: 'Trending' },
            };
        }

        async loadGeoJson() {
            console.log('Loading GeoJSON from data/wema.json...');
            try {
                const response = await fetch('data/wema.json');
                if (!response.ok) {
                    throw new Error(`Failed to fetch wema.json: ${response.status} ${response.statusText}`);
                }
                this.geojsonData = await response.json();
                console.log('GeoJSON loaded:', this.geojsonData);

                if (!this.geojsonData.features || !Array.isArray(this.geojsonData.features)) {
                    throw new Error('Invalid GeoJSON: features array missing or malformed');
                }

                console.log('Number of features:', this.geojsonData.features.length);

                this.dataLayer = L.geoJSON(this.geojsonData, {
                    pointToLayer: (feature, latlng) => {
                        const category = feature.properties?.category || 'publication';
                        console.log('Processing feature:', feature.properties?.title, 'Coordinates:', feature.geometry.coordinates);
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
                        const coords = feature.geometry?.coordinates;
                        const isValid = coords?.length === 2 &&
                                        !isNaN(coords[0]) &&
                                        !isNaN(coords[1]);
                        if (!isValid) {
                            console.warn('Filtered out invalid feature:', feature.properties?.title, 'Coordinates:', coords);
                        }
                        return isValid;
                    },
                    onEachFeature: (feature, layer) => {
                        if (layer) {
                            const category = feature.properties?.category || 'unknown';
                            layer.bindPopup(`
                                <strong>${feature.properties.title || 'Untitled'}</strong><br>
                                ${feature.properties.description || 'No description'}<br>
                                Category: ${this.styles[category]?.label || 'Unknown'}<br>
                                ${feature.properties.link ? `<a href="${feature.properties.link}" target="_blank" rel="noopener">Link</a>` : ''}
                                ${feature.properties.date ? `<br>Date: ${feature.properties.date}` : ''}
                            `);
                            console.log('Added popup for:', feature.properties?.title);
                        }
                    },
                });

                this.filterLayer();
                this.dataLayer.addTo(this.map); // Ensure layer is added to the map
                console.log('GeoJSON layer added to map');

                const bounds = this.dataLayer.getBounds();
                if (bounds.isValid()) {
                    console.log('Fitting map to bounds:', bounds);
                    this.map.fitBounds(bounds);
                } else {
                    console.warn('Invalid bounds, using default view');
                    this.map.setView(this.defaultCenter, this.defaultZoom);
                }
            } catch (error) {
                this.showError('Failed to load map data. Check console for details.');
                console.error('GeoJSON load error:', error);
            }
        }

        initializeMap() {
            console.log('Initializing map...');
            const mapElement = document.getElementById('map');
            if (!mapElement) {
                this.showError('Map container not found.');
                console.error('Map container missing');
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
                console.log('Map initialized successfully');
                return true;
            } catch (error) {
                this.showError('Failed to initialize map.');
                console.error('Map init error:', error);
                return false;
            }
        }

        centerOnUserLocation() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const { latitude, longitude } = position.coords;
                        console.log('User location:', latitude, longitude);
                        this.map.setView([latitude, longitude], 10);
                        L.marker([latitude, longitude])
                            .addTo(this.map)
                            .bindPopup('Your Location')
                            .openPopup();
                    },
                    (error) => {
                        console.warn('Geolocation error:', error.message);
                        this.showError('Unable to access location. Using default center.');
                        this.map.setView(this.defaultCenter, this.defaultZoom);
                    },
                    { timeout: 10000, enableHighAccuracy: true }
                );
            } else {
                this.showError('Geolocation not supported by your browser.');
                console.warn('Geolocation not supported');
            }
        }

        filterLayer() {
            console.log('Filtering layer by category:', this.selectedCategory);
            if (!this.dataLayer) {
                console.warn('Data layer not initialized');
                return;
            }
            this.dataLayer.eachLayer(layer => {
                const category = layer.feature.properties?.category || 'publication';
                const isVisible = this.selectedCategory === 'all' || category === this.selectedCategory;
                layer.setStyle({
                    fillOpacity: isVisible ? 0.8 : 0,
                    opacity: isVisible ? 1 : 0,
                });
            });
        }

        initializeInteractions() {
            console.log('Initializing interactions...');
            const toggleSidebar = document.getElementById('toggleSidebar');
            const sidebarContent = document.getElementById('sidebarContent');
            const categoryFilter = document.getElementById('categoryFilter');
            const themeSelect = document.getElementById('themeSelect');

            if (!toggleSidebar || !sidebarContent || !categoryFilter || !themeSelect) {
                this.showError('Failed to initialize controls.');
                console.error('Missing DOM elements:', { toggleSidebar, sidebarContent, categoryFilter, themeSelect });
                return;
            }

            toggleSidebar.addEventListener('click', () => {
                const bsCollapse = new bootstrap.Collapse(sidebarContent, { toggle: true });
                const isVisible = sidebarContent.classList.contains('show');
                toggleSidebar.setAttribute('aria-expanded', isVisible);
                console.log('Sidebar toggled:', isVisible ? 'visible' : 'hidden');
            });

            categoryFilter.addEventListener('change', (e) => {
                this.selectedCategory = e.target.value;
                console.log('Category selected:', this.selectedCategory);
                this.filterLayer();
            });

            themeSelect.addEventListener('change', (e) => {
                document.body.className = `${e.target.value}-theme`;
                console.log('Theme changed to:', e.target.value);
            });
        }

        showError(message) {
            const errorDiv = document.getElementById('errorMessage');
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
            setTimeout(() => {
                errorDiv.style.display = 'none';
            }, 5000);
        }

        async start() {
            console.log('Starting MapManager...');
            if (this.initializeMap()) {
                await this.loadGeoJson();
                this.centerOnUserLocation();
                this.initializeInteractions();
                console.log('MapManager started successfully');
            } else {
                console.error('Map initialization failed');
            }
        }
    }

    const mapManager = new MapManager();
    mapManager.start();
});