import { runningLateMessage, smsUrl, telUrl, describeVehicle, cleanVehicleColour, describeCarName, MAX_VEHICLE_COLOUR_LENGTH } from '../instructorCard';

describe('vehicle colour', () => {
  it('tidies what is typed', () => {
    expect(cleanVehicleColour('  silver  ')).toBe('Silver');
    expect(cleanVehicleColour('dark   blue')).toBe('Dark blue');
    expect(cleanVehicleColour('Akoya Silver')).toBe('Akoya Silver');
  });
  it('treats empty as no colour, and caps the length the database allows', () => {
    expect(cleanVehicleColour('')).toBeNull();
    expect(cleanVehicleColour('   ')).toBeNull();
    expect(cleanVehicleColour(null)).toBeNull();
    expect(cleanVehicleColour('x'.repeat(60))).toHaveLength(MAX_VEHICLE_COLOUR_LENGTH);
  });
  it('puts the colour in front of the make and model', () => {
    expect(describeCarName({ make_and_model: 'VW Golf', colour: 'Silver' })).toBe('Silver VW Golf');
    expect(describeCarName({ make_and_model: 'VW Golf', colour: null })).toBe('VW Golf');
    expect(describeCarName({ make_and_model: 'VW Golf', colour: '  ' })).toBe('VW Golf');
    expect(describeCarName(null)).toBe('');
  });
});

describe('runningLateMessage', () => {
  it('uses both first names', () => {
    expect(runningLateMessage('Test Pupil', 'Grant Robery')).toBe("Hi Grant, it's Test. I'm running a few minutes late for my lesson. Sorry!");
  });
  it('still reads sensibly when a name is missing', () => {
    expect(runningLateMessage('', 'Grant Robery')).toBe("Hi Grant, I'm running a few minutes late for my lesson. Sorry!");
    expect(runningLateMessage('Sam', null)).toBe("Hi, it's Sam. I'm running a few minutes late for my lesson. Sorry!");
  });
});

describe('smsUrl and telUrl', () => {
  it('separates the body with & on iOS and ? elsewhere, and drops spaces from the number', () => {
    expect(smsUrl('07700 900123', 'Hi there', 'ios')).toBe('sms:07700900123&body=Hi%20there');
    expect(smsUrl('07700 900123', 'Hi there', 'android')).toBe('sms:07700900123?body=Hi%20there');
    expect(telUrl('07700 900 123')).toBe('tel:07700900123');
  });
});

describe('describeVehicle', () => {
  it('lists make, plate and gearbox', () => {
    expect(describeVehicle({ make_and_model: 'VW Golf', registration_plate: 'AD39 ADI', transmission: 'Automatic' })).toBe('VW Golf, AD39 ADI, Automatic');
  });
  it('skips what is missing, and returns null for nothing', () => {
    expect(describeVehicle({ make_and_model: 'VW Golf', registration_plate: ' ' })).toBe('VW Golf');
    expect(describeVehicle({ make_and_model: 'VW Golf', colour: 'Silver', registration_plate: 'AD39 ADI' })).toBe('Silver VW Golf, AD39 ADI');
    expect(describeVehicle(null)).toBeNull();
    expect(describeVehicle({})).toBeNull();
  });
});
