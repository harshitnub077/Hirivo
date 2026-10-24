// Distance search without a geocoding service: a bundled table of cities (India in depth, plus
// the main global hubs), with the names job sites actually use. Sources that take a radius get it
// directly; the rest are searched city by city and filtered by distance here.

export interface City {
  name: string; // canonical, as most Indian job sites spell it
  lat: number;
  lon: number;
  country: string;
  aliases?: string[];
}

// [name, lat, lon, country, aliases]
const RAW: [string, number, number, string, string[]?][] = [
  ['Bengaluru', 12.9716, 77.5946, 'India', ['bangalore', 'bengaluru urban', 'blr']],
  ['Mumbai', 19.076, 72.8777, 'India', ['bombay', 'navi mumbai', 'thane']],
  ['New Delhi', 28.6139, 77.209, 'India', ['delhi', 'delhi ncr', 'ncr', 'new delhi']],
  ['Gurugram', 28.4595, 77.0266, 'India', ['gurgaon']],
  ['Noida', 28.5355, 77.391, 'India', ['greater noida']],
  ['Ghaziabad', 28.6692, 77.4538, 'India'],
  ['Faridabad', 28.4089, 77.3178, 'India'],
  ['Hyderabad', 17.385, 78.4867, 'India', ['secunderabad', 'cyberabad']],
  ['Pune', 18.5204, 73.8567, 'India', ['pimpri-chinchwad', 'pimpri chinchwad', 'hinjewadi']],
  ['Chennai', 13.0827, 80.2707, 'India', ['madras']],
  ['Kolkata', 22.5726, 88.3639, 'India', ['calcutta', 'salt lake', 'howrah']],
  ['Ahmedabad', 23.0225, 72.5714, 'India'],
  ['Gandhinagar', 23.2156, 72.6369, 'India', ['gift city']],
  ['Surat', 21.1702, 72.8311, 'India'],
  ['Vadodara', 22.3072, 73.1812, 'India', ['baroda']],
  ['Rajkot', 22.3039, 70.8022, 'India'],
  ['Jaipur', 26.9124, 75.7873, 'India'],
  ['Jodhpur', 26.2389, 73.0243, 'India'],
  ['Udaipur', 24.5854, 73.7125, 'India'],
  ['Kota', 25.2138, 75.8648, 'India'],
  ['Lucknow', 26.8467, 80.9462, 'India'],
  ['Kanpur', 26.4499, 80.3319, 'India'],
  ['Varanasi', 25.3176, 82.9739, 'India', ['banaras']],
  ['Prayagraj', 25.4358, 81.8463, 'India', ['allahabad']],
  ['Agra', 27.1767, 78.0081, 'India'],
  ['Meerut', 28.9845, 77.7064, 'India'],
  ['Dehradun', 30.3165, 78.0322, 'India'],
  ['Chandigarh', 30.7333, 76.7794, 'India', ['mohali', 'panchkula', 'tricity']],
  ['Ludhiana', 30.901, 75.8573, 'India'],
  ['Amritsar', 31.634, 74.8723, 'India'],
  ['Jalandhar', 31.326, 75.5762, 'India'],
  ['Shimla', 31.1048, 77.1734, 'India'],
  ['Jammu', 32.7266, 74.857, 'India'],
  ['Srinagar', 34.0837, 74.7973, 'India'],
  ['Indore', 22.7196, 75.8577, 'India'],
  ['Bhopal', 23.2599, 77.4126, 'India'],
  ['Jabalpur', 23.1815, 79.9864, 'India'],
  ['Gwalior', 26.2183, 78.1828, 'India'],
  ['Raipur', 21.2514, 81.6296, 'India'],
  ['Nagpur', 21.1458, 79.0882, 'India'],
  ['Nashik', 19.9975, 73.7898, 'India'],
  ['Aurangabad', 19.8762, 75.3433, 'India', ['chhatrapati sambhajinagar']],
  ['Kolhapur', 16.705, 74.2433, 'India'],
  ['Goa', 15.4909, 73.8278, 'India', ['panaji', 'panjim', 'margao', 'vasco da gama']],
  ['Mysuru', 12.2958, 76.6394, 'India', ['mysore']],
  ['Mangaluru', 12.9141, 74.856, 'India', ['mangalore']],
  ['Hubballi', 15.3647, 75.124, 'India', ['hubli', 'dharwad', 'hubli-dharwad']],
  ['Belagavi', 15.8497, 74.4977, 'India', ['belgaum']],
  ['Manipal', 13.3525, 74.7928, 'India', ['udupi']],
  ['Coimbatore', 11.0168, 76.9558, 'India'],
  ['Madurai', 9.9252, 78.1198, 'India'],
  ['Tiruchirappalli', 10.7905, 78.7047, 'India', ['trichy']],
  ['Salem', 11.6643, 78.146, 'India'],
  ['Vellore', 12.9165, 79.1325, 'India'],
  ['Puducherry', 11.9416, 79.8083, 'India', ['pondicherry']],
  ['Kochi', 9.9312, 76.2673, 'India', ['cochin', 'ernakulam', 'kakkanad', 'infopark']],
  ['Thiruvananthapuram', 8.5241, 76.9366, 'India', ['trivandrum', 'technopark']],
  ['Kozhikode', 11.2588, 75.7804, 'India', ['calicut']],
  ['Thrissur', 10.5276, 76.2144, 'India'],
  ['Visakhapatnam', 17.6868, 83.2185, 'India', ['vizag']],
  ['Vijayawada', 16.5062, 80.648, 'India', ['amaravati']],
  ['Guntur', 16.3067, 80.4365, 'India'],
  ['Tirupati', 13.6288, 79.4192, 'India'],
  ['Warangal', 17.9689, 79.5941, 'India'],
  ['Bhubaneswar', 20.2961, 85.8245, 'India', ['cuttack']],
  ['Patna', 25.5941, 85.1376, 'India'],
  ['Ranchi', 23.3441, 85.3096, 'India'],
  ['Jamshedpur', 22.8046, 86.2029, 'India'],
  ['Dhanbad', 23.7957, 86.4304, 'India'],
  ['Guwahati', 26.1445, 91.7362, 'India'],
  ['Shillong', 25.5788, 91.8933, 'India'],
  ['Siliguri', 26.7271, 88.3953, 'India'],
  ['Durgapur', 23.5204, 87.3119, 'India'],
  ['Kharagpur', 22.346, 87.232, 'India'],
  ['Roorkee', 29.8543, 77.888, 'India'],
  ['Sonipat', 28.9931, 77.0151, 'India'],
  ['Pilani', 28.3648, 75.5873, 'India'],
  // Global hubs
  ['Singapore', 1.3521, 103.8198, 'Singapore'],
  ['Dubai', 25.2048, 55.2708, 'United Arab Emirates'],
  ['Abu Dhabi', 24.4539, 54.3773, 'United Arab Emirates'],
  ['London', 51.5074, -0.1278, 'United Kingdom'],
  ['Manchester', 53.4808, -2.2426, 'United Kingdom'],
  ['Dublin', 53.3498, -6.2603, 'Ireland'],
  ['Amsterdam', 52.3676, 4.9041, 'Netherlands'],
  ['Berlin', 52.52, 13.405, 'Germany'],
  ['Munich', 48.1351, 11.582, 'Germany'],
  ['Paris', 48.8566, 2.3522, 'France'],
  ['Zurich', 47.3769, 8.5417, 'Switzerland'],
  ['Stockholm', 59.3293, 18.0686, 'Sweden'],
  ['Warsaw', 52.2297, 21.0122, 'Poland'],
  ['Toronto', 43.6532, -79.3832, 'Canada'],
  ['Vancouver', 49.2827, -123.1207, 'Canada'],
  ['San Francisco', 37.7749, -122.4194, 'United States', ['sf', 'bay area', 'san francisco bay area', 'palo alto', 'mountain view', 'san jose', 'sunnyvale']],
  ['Seattle', 47.6062, -122.3321, 'United States', ['bellevue', 'redmond']],
  ['New York', 40.7128, -74.006, 'United States', ['nyc', 'new york city', 'brooklyn']],
  ['Boston', 42.3601, -71.0589, 'United States', ['cambridge, ma']],
  ['Austin', 30.2672, -97.7431, 'United States'],
  ['Los Angeles', 34.0522, -118.2437, 'United States'],
  ['Chicago', 41.8781, -87.6298, 'United States'],
  ['Sydney', -33.8688, 151.2093, 'Australia'],
  ['Melbourne', -37.8136, 144.9631, 'Australia'],
  ['Tokyo', 35.6762, 139.6503, 'Japan'],
  ['Hong Kong', 22.3193, 114.1694, 'Hong Kong'],
  ['Kuala Lumpur', 3.139, 101.6869, 'Malaysia'],
  ['Jakarta', -6.2088, 106.8456, 'Indonesia'],
  ['Riyadh', 24.7136, 46.6753, 'Saudi Arabia'],
  ['Doha', 25.2854, 51.531, 'Qatar'],
];

export const CITIES: City[] = RAW.map(([name, lat, lon, country, aliases]) => ({ name, lat, lon, country, aliases }));

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
const INDEX: [string, City][] = CITIES.flatMap((c) => [c.name, ...(c.aliases || [])].map((n) => [norm(n), c] as [string, City])).sort((a, b) => b[0].length - a[0].length);

/** The city a location string names ("Bengaluru, Karnataka, India", "Gurgaon (Hybrid)"), or undefined. */
export function cityOf(location: string): City | undefined {
  const l = ` ${norm(location)} `;
  return INDEX.find(([n]) => l.includes(` ${n} `))?.[1];
}

/** Great-circle distance in km. */
export function distanceKm(a: Pick<City, 'lat' | 'lon'>, b: Pick<City, 'lat' | 'lon'>): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/** Cities within `km` of a centre, nearest first (the centre itself included). */
export function nearbyCities(center: City, km: number): City[] {
  return CITIES.filter((c) => c.country === center.country && distanceKm(center, c) <= km)
    .sort((a, b) => distanceKm(center, a) - distanceKm(center, b));
}
