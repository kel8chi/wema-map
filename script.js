document.addEventListener('DOMContentLoaded', () => {
    class MapManager {
        constructor() {
            this.map = null;
            this.clusterGroup = null;
            this.heatmapLayer = null;
            this.drawLayer = null;
            this.geojsonData = { features: [] };
            this.selectedCategory = 'all';
            this.defaultCenter = [9.0820, 8.6753]; // Nigeria center
            this.defaultZoom = 6;
            this.isDarkTheme = false;
            this.isHeatmapActive = false;
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

                // Initialize heatmap layer
                this.heatmapLayer = L.heatLayer([], {
                    radius: 25,
                    blur: 15,
                    maxZoom: 17,
                });

                // Process GeoJSON
                L.geoJSON(this.geojsonData, {
                    pointToLayer: (feature, latlng) => {
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
                            if (this.selectedCategory === 'all' || this.selectedCategory === category) {
                                this.clusterGroup.addLayer(layer);
                            }
                            // Store feature for spatial analysis
                            layer.feature = feature;
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

                // Update heatmap
                this.updateHeatmap();
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

                // Initialize draw layer
                this.drawLayer = new L.FeatureGroup();
                this.map.addLayer(this.drawLayer);

                // Initialize draw control
                const drawControl = new L.Control.Draw({
                    edit: {
                        featureGroup: this.drawLayer,
                        remove: true
                    },
                    draw: {
                        polygon: true,
                        polyline: false,
                        rectangle: false,
                        circle: true,
                        marker: true,
                        circlemarker: false
                    }
                });
                this.map.addControl(drawControl);

                // Handle draw events
                this.map.on(L.Draw.Event.CREATED, (event) => this.handleDrawEvent(event));

                return true;
            } catch (error) {
                this.showError('Failed to initialize map.');
                console.error('Map init error:', error);
                return false;
            }
        }

        handleDrawEvent(event) {
            const type = event.layerType;
            const layer = event.layer;
            this.drawLayer.clearLayers();
            this.drawLayer.addLayer(layer);

            if (this.currentAnalysis === 'buffer') {
                this.performBufferAnalysis(layer);
            } else if (this.currentAnalysis === 'spatialQuery') {
                this.performSpatialQuery(layer);
            } else if (this.currentAnalysis === 'nearestNeighbor') {
                this.performNearestNeighbor(layer);
            }
        }

        performBufferAnalysis(layer) {
            const radius = layer instanceof L.Circle ? layer.getRadius() : 1000; // Default 1km if not a circle
            const center = layer.getLatLng();
            const buffer = turf.buffer(turf.point([center.lng, center.lat]), radius / 1000, { units: 'kilometers' });
            const featuresWithin = [];

            this.clusterGroup.eachLayer((marker) => {
                if (marker.feature) {
                    const point = turf.point([marker.getLatLng().lng, marker.getLatLng().lat]);
                    if (turf.booleanPointInPolygon(point, buffer)) {
                        featuresWithin.push(marker.feature);
                        marker.setStyle({ fillColor: '#ffff00', fillOpacity: 1 }); // Highlight
                    } else {
                        const category = marker.feature.properties?.category || 'publication';
                        marker.setStyle({ fillColor: this.styles[category]?.color || '#ff7800', fillOpacity: 0.8 });
                    }
                }
            });

            const popupContent = featuresWithin.length > 0
                ? `<strong>${featuresWithin.length} features within ${radius / 1000} km</strong><br>` +
                  featuresWithin.map(f => f.properties.title).join('<br>')
                : 'No features within buffer';
            layer.bindPopup(popupContent).openPopup();
        }

        performSpatialQuery(layer) {
            const polygon = layer.toGeoJSON();
            const featuresWithin = [];

            this.clusterGroup.eachLayer((marker) => {
                if (marker.feature) {
                    const point = turf.point([marker.getLatLng().lng, marker.getLatLng().lat]);
                    if (turf.booleanPointInPolygon(point, polygon)) {
                        featuresWithin.push(marker.feature);
                        marker.setStyle({ fillColor: '#ffff00', fillOpacity: 1 }); // Highlight
                    } else {
                        const category = marker.feature.properties?.category || 'publication';
                        marker.setStyle({ fillColor: this.styles[category]?.color || '#ff7800', fillOpacity: 0.8 });
                    }
                }
            });

            const popupContent = featuresWithin.length > 0
                ? `<strong>${featuresWithin.length} features within polygon</strong><br>` +
                  featuresWithin.map(f => f.properties.title).join('<br>')
                : 'No features within polygon';
            layer.bindPopup(popupContent).openPopup();
        }

        performNearestNeighbor(layer) {
            const clickPoint = turf.point([layer.getLatLng().lng, layer.getLatLng().lat]);
            let nearestFeature = null;
            let minDistance = Infinity;

            this.clusterGroup.eachLayer((marker) => {
                if (marker.feature) {
                    const point = turf.point([marker.getLatLng().lng, marker.getLatLng().lat]);
                    const distance = turf.distance(clickPoint, point, { units: 'kilometers' });
                    if (distance < minDistance) {
                        minDistance = distance;
                        nearestFeature = marker;
                    }
                }
            });

            if (nearestFeature) {
                nearestFeature.setStyle({ fillColor: '#ffff00', fillOpacity: 1 });
                nearestFeature.openPopup();
                layer.bindPopup(`Nearest: ${nearestFeature.feature.properties.title}<br>Distance: ${minDistance.toFixed(2)} km`).openPopup();
                setTimeout(() => {
                    const category = nearestFeature.feature.properties?.category || 'publication';
                    nearestFeature.setStyle({ fillColor: this.styles[category]?.color || '#ff7800', fillOpacity: 0.8 });
                }, 5000);
            }
        }

        updateHeatmap() {
            if (!this.isHeatmapActive) return;
            const points = [];
            this.clusterGroup.eachLayer((marker) => {
                if (marker.feature) {
                    const category = marker.feature.properties?.category || 'publication';
                    if (this.selectedCategory === 'all' || this.selectedCategory === category) {
                        points.push([marker.getLatLng().lat, marker.getLatLng().lng, 1]);
                    }
                }
            });
            this.heatmapLayer.setLatLngs(points);
            this.heatmapLayer.addTo(this.map);
        }

        toggleHeatmap() {
            this.isHeatmapActive = !this.isHeatmapActive;
            const toggleButton = document.getElementById('toggleHeatmap');
            toggleButton.innerHTML = `<i class="bi bi-fire"></i> ${this.isHeatmapActive ? 'Hide' : 'Show'} Heatmap`;
            if (this.isHeatmapActive) {
                this.map.removeLayer(this.clusterGroup);
                this.updateHeatmap();
            } else {
                this.map.removeLayer(this.heatmapLayer);
                this.clusterGroup.addTo(this.map);
            }
            console.log('Heatmap toggled:', this.isHeatmapActive ? 'on' : 'off');
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
            this.clusterGroup.clearLayers();
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
                    return this.selectedCategory === 'all' || this.selectedCategory === category;
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
                    layer.feature = feature; // Store feature for spatial analysis
                    this.clusterGroup.addLayer(layer);
                },
            });
            this.clusterGroup.addTo(this.map);
            this.updateHeatmap();
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
            const bufferAnalysis = document.getElementById('bufferAnalysis');
            const spatialQuery = document.getElementById('spatialQuery');
            const nearestNeighbor = document.getElementById('nearestNeighbor');
            const toggleHeatmap = document.getElementById('toggleHeatmap');

            if (!toggleSidebar || !sidebarContent || !categoryFilter || !themeToggle || !bufferAnalysis || !spatialQuery || !nearestNeighbor || !toggleHeatmap) {
                this.showError('Failed to initialize controls.');
                console.error('Missing DOM elements:', { toggleSidebar, sidebarContent, categoryFilter, themeToggle, bufferAnalysis, spatialQuery, nearestNeighbor, toggleHeatmap });
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

            bufferAnalysis.addEventListener('click', () => {
                this.currentAnalysis = 'buffer';
                new L.Draw.Circle(this.map, { shapeOptions: { color: '#ff0000' } }).enable();
                this.showError('Draw a circle to perform buffer analysis');
            });

            spatialQuery.addEventListener('click', () => {
                this.currentAnalysis = 'spatialQuery';
                new L.Draw.Polygon(this.map, { shapeOptions: { color: '#ff0000' } }).enable();
                this.showError('Draw a polygon to select features');
            });

            nearestNeighbor.addEventListener('click', () => {
                this.currentAnalysis = 'nearestNeighbor';
                new L.Draw.Marker(this.map, { icon: L.icon({ iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png' }) }).enable();
                this.showError('Place a marker to find the nearest feature');
            });

            toggleHeatmap.addEventListener('click', () => {
                this.toggleHeatmap();
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