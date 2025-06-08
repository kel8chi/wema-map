document.addEventListener('DOMContentLoaded', () => {
    class MapManager {
        constructor() {
            this.map = null;
            this.clusterGroup = null;
            this.heatmapLayer = null;
            this.drawLayer = null;
            this.geojsonData = { features: [] };
            this.selectedCategory = 'all';
            this.searchQuery = '';
            this.visibleCategories = new Set(['publication', 'event', 'vendor', 'service', 'waste', 'trending']);
            this.defaultCenter = [9.0820, 8.6753];
            this.defaultZoom = 6;
            this.isDarkTheme = localStorage.getItem('theme') === 'dark';
            this.isHeatmapActive = false;
            this.userPoints = parseInt(localStorage.getItem('userPoints')) || 0;
            this.userBadges = JSON.parse(localStorage.getItem('userBadges')) || [];
            this.bookmarks = JSON.parse(localStorage.getItem('bookmarks')) || [];
            this.spatialAnalyses = parseInt(localStorage.getItem('spatialAnalyses')) || 0;
            this.currentAnalysis = null;
            this.dailyChallenge = this.getDailyChallenge();
            this.leaderboard = JSON.parse(localStorage.getItem('leaderboard')) || [
                { name: 'EcoWarrior', points: 500 },
                { name: 'GreenExplorer', points: 400 },
                { name: 'You', points: this.userPoints }
            ];
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
            this.achievements = [
                { id: 'explorer', name: 'Explorer', points: 10, condition: () => this.userPoints >= 100 },
                { id: 'analyst', name: 'Spatial Analyst', points: 5, condition: () => this.spatialAnalyses >= 5 },
                { id: 'trendsetter', name: 'Trendsetter', points: 15, condition: () => this.bookmarks.filter(b => b.properties.category === 'trending').length >= 3 },
            ];
        }

        async loadGeoJson() {
            try {
                const response = await fetch('data/wema.json');
                if (!response.ok) throw new Error(`Failed to fetch wema.json: ${response.status} ${response.statusText}`);
                this.geojsonData = await response.json();
                if (!this.geojsonData.features || !Array.isArray(this.geojsonData.features)) {
                    throw new Error('Invalid GeoJSON: features array missing or malformed');
                }

                this.clusterGroup = L.markerClusterGroup({
                    maxClusterRadius: 50,
                    iconCreateFunction: (cluster) => L.divIcon({
                        html: `<div style="background-color: #007bff; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;">${cluster.getChildCount()}</div>`,
                        className: 'marker-cluster',
                        iconSize: L.point(30, 30)
                    }),
                    spiderfyOnMaxZoom: true,
                    disableClusteringAtZoom: 15,
                    chunkedLoading: true,
                });

                this.heatmapLayer = L.heatLayer([], {
                    radius: 25,
                    blur: 15,
                    maxZoom: 17,
                });

                // Chunked loading of features
                this.geojsonData.features.forEach((feature, index) => {
                    setTimeout(() => this.addFeatureToMap(feature), index * 10);
                });

                this.clusterGroup.addTo(this.map);
                const bounds = this.clusterGroup.getBounds();
                if (bounds.isValid()) {
                    this.map.fitBounds(bounds);
                } else {
                    this.map.setView(this.defaultCenter, this.defaultZoom);
                }

                this.updateHeatmap();
                this.updateBookmarks();
                this.updateGamificationUI();
                this.updateLeaderboard();
            } catch (error) {
                this.showError('Failed to load map data. Check console for details.');
                console.error('GeoJSON load error:', error);
            }
        }

        addFeatureToMap(feature) {
            const coords = feature.geometry?.coordinates;
            if (!coords?.length === 2 || isNaN(coords[0]) || isNaN(coords[1])) {
                console.warn('Filtered out invalid feature:', feature.properties?.title, 'Coordinates:', coords);
                return;
            }

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

            const isBookmarked = this.bookmarks.some(b => b.properties.id === feature.properties.id);
            marker.bindPopup(`
                <strong>${feature.properties.title || 'Untitled'}</strong><br>
                ${feature.properties.description || 'No description'}<br>
                Category: ${this.styles[category]?.label || 'Unknown'}<br>
                ${feature.properties.link ? `<a href="${feature.properties.link}" target="_blank" rel="noopener">Link</a>` : ''}
                ${feature.properties.date ? `<br>Date: ${feature.properties.date}` : ''}
                <br><button class="btn btn-sm btn-primary bookmark-btn" data-id="${feature.properties.id}">${isBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}</button>
                <br><button class="btn btn-sm btn-primary share-btn" data-id="${feature.properties.id}">Share Location</button>
            `);

            marker.on('popupopen', () => {
                this.addPoints(5); // Points for exploring
                this.checkChallengeProgress(feature);
                document.querySelectorAll('.bookmark-btn').forEach(btn => {
                    btn.addEventListener('click', () => this.toggleBookmark(feature));
                });
                document.querySelectorAll('.share-btn').forEach(btn => {
                    btn.addEventListener('click', () => this.shareLocation(feature));
                });
            });

            if (this.isFeatureVisible(feature)) {
                this.clusterGroup.addLayer(marker);
            }
            marker.feature = feature;
        }

        isFeatureVisible(feature) {
            const category = feature.properties?.category || 'publication';
            const title = feature.properties?.title?.toLowerCase() || '';
            const description = feature.properties?.description?.toLowerCase() || '';
            return (
                (this.selectedCategory === 'all' || this.selectedCategory === category) &&
                this.visibleCategories.has(category) &&
                (!this.searchQuery || title.includes(this.searchQuery) || description.includes(this.searchQuery))
            );
        }

        initializeMap() {
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
                    layers: [this.isDarkTheme ? this.tileLayers.dark : this.tileLayers.light]
                });

                this.drawLayer = new L.FeatureGroup();
                this.map.addLayer(this.drawLayer);

                const drawControl = new L.Control.Draw({
                    edit: { featureGroup: this.drawLayer, remove: true },
                    draw: { polygon: true, polyline: false, rectangle: false, circle: true, marker: true, circlemarker: false }
                });
                this.map.addControl(drawControl);

                this.map.on(L.Draw.Event.CREATED, (event) => this.handleDrawEvent(event));
                return true;
            } catch (error) {
                this.showError('Failed to initialize map.');
                console.error('Map init error:', error);
                return false;
            }
        }

        handleDrawEvent(event) {
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
            this.addPoints(10); // Points for analysis
            this.spatialAnalyses++;
            localStorage.setItem('spatialAnalyses', this.spatialAnalyses);
            this.checkAchievements();
            this.updateGamificationUI();
        }

        performBufferAnalysis(layer) {
            const radius = layer instanceof L.Circle ? layer.getRadius() : 1000;
            const center = layer.getLatLng();
            const buffer = turf.buffer(turf.point([center.lng, center.lat]), radius / 1000, { units: 'kilometers' });
            const featuresWithin = [];

            this.clusterGroup.eachLayer((marker) => {
                if (marker.feature) {
                    const point = turf.point([marker.getLatLng().lng, marker.getLatLng().lat]);
                    if (turf.booleanPointInPolygon(point, buffer)) {
                        featuresWithin.push(marker.feature);
                        marker.setStyle({ fillColor: '#ffff00', fillOpacity: 1 });
                    } else {
                        const category = marker.feature.properties?.category || 'publication';
                        marker.setStyle({ fillColor: this.styles[category]?.color || '#ff7800', fillOpacity: 0.8 });
                    }
                }
            });

            layer.bindPopup(
                featuresWithin.length > 0
                    ? `<strong>${featuresWithin.length} features within ${radius / 1000} km</strong><br>${featuresWithin.map(f => f.properties.title).join('<br>')}`
                    : 'No features within buffer'
            ).openPopup();
        }

        performSpatialQuery(layer) {
            const polygon = layer.toGeoJSON();
            const featuresWithin = [];

            this.clusterGroup.eachLayer((marker) => {
                if (marker.feature) {
                    const point = turf.point([marker.getLatLng().lng, marker.getLatLng().lat]);
                    if (turf.booleanPointInPolygon(point, polygon)) {
                        featuresWithin.push(marker.feature);
                        marker.setStyle({ fillColor: '#ffff00', fillOpacity: 1 });
                    } else {
                        const category = marker.feature.properties?.category || 'publication';
                        marker.setStyle({ fillColor: this.styles[category]?.color || '#ff7800', fillOpacity: 0.8 });
                    }
                }
            });

            layer.bindPopup(
                featuresWithin.length > 0
                    ? `<strong>${featuresWithin.length} features within polygon</strong><br>${featuresWithin.map(f => f.properties.title).join('<br>')}`
                    : 'No features within polygon'
            ).openPopup();
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
                if (marker.feature && this.isFeatureVisible(marker.feature)) {
                    points.push([marker.getLatLng().lat, marker.getLatLng().lng, 1]);
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
            this.addPoints(5); // Points for toggling heatmap
        }

        centerOnUserLocation() {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const { latitude, longitude } = position.coords;
                        this.map.setView([latitude, longitude], 10);
                        L.marker([latitude, longitude]).addTo(this.map).bindPopup('Your Location').openPopup();
                        this.addPoints(10); // Points for locating
                    },
                    (error) => {
                        this.showError('Unable to access location. Using default center.');
                        this.map.setView(this.defaultCenter, this.defaultZoom);
                    },
                    { timeout: 10000, enableHighAccuracy: true }
                );
            } else {
                this.showError('Geolocation not supported by your browser.');
            }
        }

        filterLayer() {
            this.clusterGroup.clearLayers();
            L.geoJSON(this.geojsonData, {
                pointToLayer: (feature, latlng) => {
                    const coords = feature.geometry.coordinates;
                    const correctedLatLng = [coords[1], coords[0]];
                    const category = feature.properties?.category || 'publication';
                    return L.circleMarker(correctedLatLng, {
                        radius: 8,
                        fillColor: this.styles[category]?.color || '#ff7800',
                        color: '#000',
                        weight: 1,
                        opacity: 1,
                        fillOpacity: 0.8,
                    });
                },
                filter: (feature) => this.isFeatureVisible(feature),
                onEachFeature: (feature, layer) => {
                    const category = feature.properties?.category || 'unknown';
                    const isBookmarked = this.bookmarks.some(b => b.properties.id === feature.properties.id);
                    layer.bindPopup(`
                        <strong>${feature.properties.title || 'Untitled'}</strong><br>
                        ${feature.properties.description || 'No description'}<br>
                        Category: ${this.styles[category]?.label || 'Unknown'}<br>
                        ${feature.properties.link ? `<a href="${feature.properties.link}" target="_blank" rel="noopener">Link</a>` : ''}
                        ${feature.properties.date ? `<br>Date: ${feature.properties.date}` : ''}
                        <br><button class="btn btn-sm btn-primary bookmark-btn" data-id="${feature.properties.id}">${isBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}</button>
                        <br><button class="btn btn-sm btn-primary share-btn" data-id="${feature.properties.id}">Share Location</button>
                    `);
                    layer.feature = feature;
                    layer.on('popupopen', () => {
                        this.addPoints(5);
                        this.checkChallengeProgress(feature);
                        document.querySelectorAll('.bookmark-btn').forEach(btn => {
                            btn.addEventListener('click', () => this.toggleBookmark(feature));
                        });
                        document.querySelectorAll('.share-btn').forEach(btn => {
                            btn.addEventListener('click', () => this.shareLocation(feature));
                        });
                    });
                    this.clusterGroup.addLayer(layer);
                },
            });
            this.clusterGroup.addTo(this.map);
            this.updateHeatmap();
        }

        toggleBookmark(feature) {
            const index = this.bookmarks.findIndex(b => b.properties.id === feature.properties.id);
            if (index === -1) {
                this.bookmarks.push(feature);
                this.addPoints(5); // Points for bookmarking
                this.showError('Bookmarked: ' + feature.properties.title);
            } else {
                this.bookmarks.splice(index, 1);
                this.showError('Removed bookmark: ' + feature.properties.title);
            }
            localStorage.setItem('bookmarks', JSON.stringify(this.bookmarks));
            this.updateBookmarks();
            this.checkAchievements();
            this.filterLayer();
        }

        updateBookmarks() {
            const bookmarkList = document.getElementById('bookmarkList');
            bookmarkList.innerHTML = this.bookmarks.length === 0
                ? '<li>No bookmarks</li>'
                : this.bookmarks.map(b => `
                    <li>
                        <a href="#" class="bookmark-link" data-id="${b.properties.id}">${b.properties.title}</a>
                        <button class="btn btn-sm btn-danger remove-bookmark" data-id="${b.properties.id}">Remove</button>
                    </li>
                `).join('');
            document.querySelectorAll('.bookmark-link').forEach(link => {
                link.addEventListener('click', (e) => {
                    const id = e.target.dataset.id;
                    const feature = this.bookmarks.find(b => b.properties.id == id);
                    if (feature) {
                        const coords = feature.geometry.coordinates;
                        this.map.setView([coords[1], coords[0]], 12);
                        this.clusterGroup.eachLayer(layer => {
                            if (layer.feature.properties.id == id) layer.openPopup();
                        });
                    }
                });
            });
            document.querySelectorAll('.remove-bookmark').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = e.target.dataset.id;
                    const feature = this.bookmarks.find(b => b.properties.id == id);
                    if (feature) this.toggleBookmark(feature);
                });
            });
        }

        shareLocation(feature) {
            const coords = feature.geometry.coordinates;
            const url = `${window.location.origin}${window.location.pathname}?lat=${coords[1]}&lng=${coords[0]}&zoom=12&feature=${feature.properties.id}`;
            navigator.clipboard.writeText(url).then(() => {
                this.showError('Link copied to clipboard!');
                this.addPoints(5); // Points for sharing
            }).catch(() => this.showError('Failed to copy link.'));
        }

        shareMapView() {
            const center = this.map.getCenter();
            const zoom = this.map.getZoom();
            const url = `${window.location.origin}${window.location.pathname}?lat=${center.lat}&lng=${center.lng}&zoom=${zoom}`;
            navigator.clipboard.writeText(url).then(() => {
                this.showError('Map view link copied to clipboard!');
                this.addPoints(5);
            }).catch(() => this.showError('Failed to copy link.'));
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
            localStorage.setItem('theme', this.isDarkTheme ? 'dark' : 'light');
            this.addPoints(5); // Points for theme toggle
        }

        addPoints(points) {
            this.userPoints += points;
            localStorage.setItem('userPoints', this.userPoints);
            this.updateGamificationUI();
            this.updateLeaderboard();
            this.checkAchievements();
        }

        checkAchievements() {
            this.achievements.forEach(achievement => {
                if (!this.userBadges.includes(achievement.id) && achievement.condition()) {
                    this.userBadges.push(achievement.id);
                    this.addPoints(achievement.points);
                    this.showError(`Achievement Unlocked: ${achievement.name}!`);
                }
            });
            localStorage.setItem('userBadges', JSON.stringify(this.userBadges));
            this.updateGamificationUI();
        }

        updateGamificationUI() {
            document.getElementById('userPoints').textContent = this.userPoints;
            document.getElementById('userBadges').textContent = this.userBadges.length === 0
                ? 'None'
                : this.userBadges.map(id => this.achievements.find(a => a.id === id).name).join(', ');
            document.getElementById('dailyChallenge').textContent = this.dailyChallenge.task;
        }

        updateLeaderboard() {
            this.leaderboard.find(user => user.name === 'You').points = this.userPoints;
            this.leaderboard.sort((a, b) => b.points - a.points);
            localStorage.setItem('leaderboard', JSON.stringify(this.leaderboard));
            const leaderboardList = document.getElementById('leaderboardList');
            leaderboardList.innerHTML = this.leaderboard.map((user, index) => `
                <li>${index + 1}. ${user.name}: ${user.points} points</li>
            `).join('');
        }

        getDailyChallenge() {
            const challenges = [
                { task: 'Find 3 trending locations', check: () => this.bookmarks.filter(b => b.properties.category === 'trending').length >= 3, reward: 20 },
                { task: 'Perform 2 spatial analyses', check: () => this.spatialAnalyses >= 2, reward: 15 },
                { task: 'Bookmark 5 locations', check: () => this.bookmarks.length >= 5, reward: 10 },
            ];
            const today = new Date().toDateString();
            const storedChallenge = localStorage.getItem('dailyChallenge');
            if (storedChallenge && JSON.parse(storedChallenge).date === today) {
                return JSON.parse(storedChallenge).challenge;
            }
            const challenge = challenges[Math.floor(Math.random() * challenges.length)];
            localStorage.setItem('dailyChallenge', JSON.stringify({ date: today, challenge }));
            return challenge;
        }

        checkChallengeProgress(feature) {
            if (this.dailyChallenge.check()) {
                this.addPoints(this.dailyChallenge.reward);
                this.showError(`Daily Challenge Completed: ${this.dailyChallenge.task}! +${this.dailyChallenge.reward} points`);
                localStorage.removeItem('dailyChallenge');
                this.dailyChallenge = this.getDailyChallenge();
                this.updateGamificationUI();
            }
        }

        initializeInteractions() {
            const toggleSidebar = document.getElementById('toggleSidebar');
            const sidebarContent = document.getElementById('sidebarContent');
            const categoryFilter = document.getElementById('categoryFilter');
            const searchInput = document.getElementById('searchInput');
            const themeToggle = document.getElementById('themeToggle');
            const bufferAnalysis = document.getElementById('bufferAnalysis');
            const spatialQuery = document.getElementById('spatialQuery');
            const nearestNeighbor = document.getElementById('nearestNeighbor');
            const toggleHeatmap = document.getElementById('toggleHeatmap');
            const shareMap = document.getElementById('shareMap');
            const viewLeaderboard = document.getElementById('viewLeaderboard');
            const legend = document.getElementById('legend');

            if (!toggleSidebar || !sidebarContent || !categoryFilter || !searchInput || !themeToggle || !bufferAnalysis || !spatialQuery || !nearestNeighbor || !toggleHeatmap || !shareMap || !viewLeaderboard || !legend) {
                this.showError('Failed to initialize controls.');
                return;
            }

            toggleSidebar.addEventListener('click', () => {
                const bsCollapse = new bootstrap.Collapse(sidebarContent, { toggle: true });
                toggleSidebar.setAttribute('aria-expanded', sidebarContent.classList.contains('show'));
            });

            categoryFilter.addEventListener('change', (e) => {
                this.selectedCategory = e.target.value;
                this.filterLayer();
            });

            let searchTimeout;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(searchTimeout);
                searchTimeout = setTimeout(() => {
                    this.searchQuery = e.target.value.toLowerCase();
                    this.filterLayer();
                }, 300); // Debounced search
            });

            themeToggle.addEventListener('click', () => this.toggleTheme());

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

            toggleHeatmap.addEventListener('click', () => this.toggleHeatmap());

            shareMap.addEventListener('click', () => this.shareMapView());

            viewLeaderboard.addEventListener('click', () => {
                const modal = new bootstrap.Modal(document.getElementById('leaderboardModal'));
                modal.show();
            });

            legend.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
                checkbox.addEventListener('change', (e) => {
                    const category = e.target.parentElement.dataset.category;
                    if (e.target.checked) {
                        this.visibleCategories.add(category);
                    } else {
                        this.visibleCategories.delete(category);
                    }
                    this.filterLayer();
                });
            });

            // Handle URL parameters for shared views
            const urlParams = new URLSearchParams(window.location.search);
            const lat = parseFloat(urlParams.get('lat'));
            const lng = parseFloat(urlParams.get('lng'));
            const zoom = parseInt(urlParams.get('zoom'));
            const featureId = urlParams.get('feature');
            if (lat && lng && zoom) {
                this.map.setView([lat, lng], zoom);
            }
            if (featureId) {
                setTimeout(() => {
                    this.clusterGroup.eachLayer(layer => {
                        if (layer.feature.properties.id == featureId) layer.openPopup();
                    });
                }, 1000);
            }
        }

        showError(message) {
            const errorDiv = document.getElementById('errorMessage');
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
            setTimeout(() => errorDiv.style.display = 'none', 5000);
        }

        async start() {
            if (this.initializeMap()) {
                await this.loadGeoJson();
                this.centerOnUserLocation();
                this.initializeInteractions();
                this.updateGamificationUI();
            } else {
                console.error('Map initialization failed');
            }
        }
    }

    const mapManager = new MapManager();
    mapManager.start();
});