const upsAPI = require('ups-nodejs-sdk');
const {Client} = require("@googlemaps/google-maps-services-js");
require('dotenv').config();

const args = process.argv.slice(2);
if (args.length != 1) {
  console.error('The tracking number argument is required!');
  return 1;
}
const trackingNumber = args[0];

const conf = {
  environment: process.env.UPS_ENV,
  username: process.env.UPS_USER,
  password: process.env.UPS_PASSWORD,
  access_key: process.env.UPS_KEY,
}

var ups = new upsAPI(conf);

function get_addresses(res) {
  const shipment = res['Shipment'];
  if (shipment && shipment.ShipTo && shipment.ShipTo.Address) {
    const pack = shipment.Package;
    if (pack && pack.Activity) {
      const a = pack.Activity.find(a=>a.Status&&a.Status.StatusCode&&a.Status.StatusCode.Code==='OR');
      const b = pack.Activity.find(a=>a.Status&&a.Status.StatusType&&a.Status.StatusType.Code==='D');
      const origin = [];
      const dest = [];
      if (a && a.ActivityLocation && a.ActivityLocation.Address && b && b.ActivityLocation && b.ActivityLocation.Address) {
        const o = a.ActivityLocation.Address;
        const d = b.ActivityLocation.Address;
        for (let p in o) {
          origin.push(o[p]);
        }
        for (let p in d) {
          dest.push(d[p]);
        }
        if (dest && origin) {
          return {dest, origin };
        }
      }
    }
  }
  return null;
}

function is_ground(res) {
  const shipment = res['Shipment'];
  if (shipment && shipment.Service && shipment.Service.Code) {
    return shipment.Service.Code.toLowerCase().indexOf('03') > -1;
  } else {
    return true;
  }
}

function calc_distance(o, d) {

  // The math module contains a function
  // named toRadians which converts from
  // degrees to radians.
  const lon1 = Math.PI / 180 * (o.lng);
  const lon2 = Math.PI / 180 * (d.lng);
  const lat1 = Math.PI / 180 * (o.lat);
  const lat2 = Math.PI / 180 * (d.lat);

  // Haversine formula
  const dlon = lon2 - lon1;
  const dlat = lat2 - lat1;
  const a = Math.pow(Math.sin(dlat / 2), 2)
    + Math.cos(lat1) * Math.cos(lat2)
      * Math.pow(Math.sin(dlon / 2),2);

  const c = 2 * Math.asin(Math.sqrt(a));

  // Radius of earth
  return 6371.0 * c;
}

ups.track(trackingNumber, {latest: false}, (err, res) => {
  if (err) console.error('An error occurred: ', err);
  else {
    const isGround = is_ground(res);
    const output = { ups: res };
    let weight = 0.0;
    if (res.Shipment && res.Shipment.ShipmentWeight) {
      const w = res.Shipment.ShipmentWeight;
      weight = w.Weight;
      if (w.UnitOfMeasurement.Code === 'LBS') {
        weight *= 0.453592;
      }
      output.weight = {
        value: weight,
        unit: 'kg'
      }
      let emissions = weight * 0.001 * (isGround ? 0.52218 : 2.37968);
      output.emissions = { value: emissions, unit: 'kgCO2e' }
    }
    const addresses = get_addresses(res);
    if (addresses) {
      const client = new Client({});
      const address_o = addresses.origin.join(' ');
      const address_d = addresses.dest.join(' ');
      if (isGround) {
        client.distancematrix({
          params: {
            origins: [address_o],
            destinations: [address_d],
            units: 'metric',
            key: process.env.GOOGLE_KEY
          }
        }).then((results)=>{
            const dist = results.data.rows[0].elements[0].distance;
            // the value is always in meter, need to convert into either km or mi
            const dist_m = dist.value / 1000;

            output.distance = {
              origin: {
                address: address_o,
              },
              destination: {
                address: address_d,
              },
              value: dist_m,
              unit: 'km'
            };
            console.log(JSON.stringify(output, null, 4));
        }).catch((err)=>{
            output.distance = {error: err.response.data};
            console.log(JSON.stringify(output, null, 4));
        });
      } else {
        client.geocode({
          params: {
            address: address_o,
            key: process.env.GOOGLE_KEY
          }
        }).then((results)=>{
            const origin_r = results.data.results[0].geometry.location;
            client.geocode({
              params: {
                address: address_d,
                key: process.env.GOOGLE_KEY
              }
            }).then((results)=>{
                const dest_r = results.data.results[0].geometry.location;
                output.distance = {
                  origin: {
                    address: address_o,
                    coords: origin_r
                  },
                  destination: {
                    address: address_d,
                    coords: dest_r
                  },
                  value: calc_distance(origin_r, dest_r),
                  unit: 'km'
                };
                console.log(JSON.stringify(output, null, 4));
            }).catch((err)=>{
                output.distance = {error: err.response.data};
                console.log(JSON.stringify(output, null, 4));
            });
        }).catch((err)=>{
            output.geocode = {error: err.response.data};
            console.log(JSON.stringify(output, null, 4));
        });
      }
    } else {
      console.log(JSON.stringify(output, null, 4));
    }
  }
})
