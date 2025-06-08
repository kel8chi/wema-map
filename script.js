document.addEventListener('DOMContentLoaded', () => {
    class MapManager {
        constructor() {
            this.map = null;
            this.clusterGroup = null;
            this.geojsonData = { features: [] };
            this.selectedCategory = 'all';
            this.defaultCenter = [9.0820, 8.6753]; // Nigeria center
            this.defaultZoom = 6;
            this.isDarkTheme = false;
            this.tileLayers = {
                light: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
                    maxZoom: 18,
                }),
                dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                    attribution: '© <a href="https://carto.com/attributions">CARTO</a>',
                    maxZoom: 18,
                })
            };

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

                // Initialize cluster group
                this.clusterGroup = L.markerClusterGroup({
                    maxClusterRadius: 50,
                    iconCreateFunction: (cluster) => {
                        return L.divIcon({
                            html: `<div style="background-color: #007bff; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;">${cluster.getChildCount()}</div>`,
                            className: 'marker-cluster',
                            iconSize: L.point(30, 30)
                        });
                    }
                });

                // Process GeoJSON
                L.geoJSON(this.geojsonData, {
                    pointToLayer: (feature, latlng) => {
                        // Swap coordinates: GeoJSON is [lng, lat], Leaflet needs [lat, lng]
                        const coords = feature.geometry.coordinates;
                        const correctedLatLng = [coords[1], coords[0]];
                        const category = feature.properties?.category || 'publication';
                        console.log('Processing feature:', feature.properties?.title, 'Corrected Coordinates:', correctedLatLng);
                        const marker = L.circleMarker(correctedLatLng, {
                            radius: 8,
                            fillColor: this.styles[category]?.color || '#ff7800',
                            color: '#000',
                            weight: 1,
                            opacity: 1,
                            fillOpacity: 0.8,
                        });
                        return marker;
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
                            // Add marker to cluster group based on category
                            if (this.selectedCategory === 'all' || this.selectedCategory === category) {
                                this.clusterGroup.addLayer(layer);
                            }
                        }
                    },
                });

                // Add cluster group to map
                this.clusterGroup.addTo(this.map);
                console.log('GeoJSON layer added to map with clustering');

                const bounds = this.clusterGroup.getBounds();
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
                    layers: [this.tileLayers.light]
                });
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
            if (!this.clusterGroup) {
                console.warn('Cluster group not initialized');
                return;
            }
            // Clear existing layers
            this.clusterGroup.clearLayers();
            // Re-add layers based on selected category
            L.geoJSON(this.geojsonData, {
                pointToLayer: (feature, latlng) => {
                    const coords = feature.geometry.coordinates;
                    const correctedLatLng = [coords[1], coords[0]];
                    const category = feature.properties?.category || 'publication';
                    const marker = L.circleMarker(correctedLatLng, {
                        radius: 8,
                        fillColor: this.styles[category]?.color || '#ff7800',
                        color: '#000',
                        weight: 1,
                        opacity: 1,
                        fillOpacity: 0.8,
                    });
                    return marker;
                },
                filter: (feature) => {
                    const coords = feature.geometry?.coordinates;
                    const isValid = coords?.length === 2 &&
                                    !isNaN(coords[0]) &&
                                    !isNaN(coords[1]);
                    if (!isValid) return false;
                    const category = feature.properties?.category || 'publication';
                    return this.selectedCategory === 'all' || category === this.selectedCategory;
                },
                onEachFeature: (feature, layer) => {
                    const category = feature.properties?.category || 'unknown';
                    layer.bindPopup(`
                        <strong>${feature.properties.title || 'Untitled'}</strong><br>
                        ${feature.properties.description || 'No description'}<br>
                        Category: ${this.styles[category]?.label || 'Unknown'}<br>
                        ${feature.properties.link ? `<a href="${feature.properties.link}" target="_blank" rel="noopener">Link</a>` : ''}
                        ${feature.properties.date ? `<br>Date: ${feature.properties.date}` : ''}
                    `);
                    this.clusterGroup.addLayer(layer);
                },
            });
            this.clusterGroup.addTo(this.map);
            console.log('Layer filtered and added to map');
        }

        toggleTheme() {
            this.isDarkTheme = !this.isDarkTheme;
            document.body.className = this.isDarkTheme ? 'dark-theme' : 'light-theme';
            const themeButton = document.getElementById('themeToggle');
            themeButton.innerHTML = `<i class="bi bi-${this.isDarkTheme ? 'sun-fill' : 'moon-stars-fill'}"></i> Toggle ${this.isDarkTheme ? 'Light' : 'Dark'} Theme`;
            if (this.isDarkTheme) {
                this.map.removeLayer(this.tileLayers.light);
                this.tileLayers.dark.addTo(this.map);
            } else {
                this.map.removeLayer(this.tileLayers.dark);
                this.tileLayers.light.addTo(this.map);
            }
            console.log('Theme toggled to:', this.isDarkTheme ? 'dark' : 'light');
        }

        initializeInteractions() {
            console.log('Initializing interactions...');
            const toggleSidebar = document.getElementById('toggleSidebar');
            const sidebarContent = document.getElementById('sidebarContent');
            const categoryFilter = document.getElementById('categoryFilter');
            const themeToggle = document.getElementById('themeToggle');

            if (!toggleSidebar || !sidebarContent || !categoryFilter || !themeToggle) {
                this.showError('Failed to initialize controls.');
                console.error('Missing DOM elements:', { toggleSidebar, sidebarContent, categoryFilter, themeToggle });
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

            themeToggle.addEventListener('click', () => {
                this.toggleTheme();
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