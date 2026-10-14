import { runningLateMessage, smsUrl, telUrl, describeVehicle } from '../instructorCard';

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
    expect(smsUrl('07806 750559', 'Hi there', 'ios')).toBe('sms:07806750559&body=Hi%20there');
    expect(smsUrl('07806 750559', 'Hi there', 'android')).toBe('sms:07806750559?body=Hi%20there');
    expect(telUrl('07806 750 559')).toBe('tel:07806750559');
  });
});

describe('describeVehicle', () => {
  it('lists make, plate and gearbox', () => {
    expect(describeVehicle({ make_and_model: 'VW Golf', registration_plate: 'AD39 ADI', transmission: 'Automatic' })).toBe('VW Golf, AD39 ADI, Automatic');
  });
  it('skips what is missing, and returns null for nothing', () => {
    expect(describeVehicle({ make_and_model: 'VW Golf', registration_plate: ' ' })).toBe('VW Golf');
    expect(describeVehicle(null)).toBeNull();
    expect(describeVehicle({})).toBeNull();
  });
});
