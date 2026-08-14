// Official DVSA "show me, tell me" vehicle safety questions asked during the
// UK car practical driving test — one 'tell me' question before driving,
// one 'show me' question while driving, chosen at random by the examiner
// from these fixed lists (14 tell me + 7 show me = 21 total).
//
// Source: gov.uk "Car 'show me, tell me' vehicle safety questions" —
// Driver and Vehicle Standards Agency, last updated 4 December 2017.
// https://www.gov.uk/government/publications/car-show-me-tell-me-vehicle-safety-questions
// Crown copyright, reused under the Open Government Licence v3.0.

export type ShowMeTellMeQuestion = {
  id: string;
  question: string;
  answer: string;
  /** Only set for the three "tell me" questions that require opening the
   * bonnet (oil, coolant, brake fluid) — worth a visible flag since these
   * are the ones learners most often forget need a physical action even
   * though they're in the "tell me" (not "show me") half of the test. */
  requiresBonnetOpen?: boolean;
};

export const TELL_ME_QUESTIONS: ShowMeTellMeQuestion[] = [
  {
    id: 'tm1',
    question: "Tell me how you'd check that the brakes are working before starting a journey.",
    answer: 'Brakes should not feel spongy or slack. Brakes should be tested as you set off. Vehicle should not pull to one side.',
  },
  {
    id: 'tm2',
    question: "Tell me where you'd find the information for the recommended tyre pressures for this car and how tyre pressures should be checked.",
    answer: "Manufacturer's guide, use a reliable pressure gauge, check and adjust pressures when tyres are cold, don't forget the spare tyre, remember to refit valve caps.",
  },
  {
    id: 'tm3',
    question: 'Tell me how you make sure your head restraint is correctly adjusted so it provides the best protection in the event of a crash.',
    answer: 'The head restraint should be adjusted so the rigid part of the head restraint is at least as high as the eyes or top of the ears, and as close to the back of the head as is comfortable. Note: some restraints might not be adjustable.',
  },
  {
    id: 'tm4',
    question: "Tell me how you'd check the tyres to ensure that they have sufficient tread depth and that their general condition is safe to use on the road.",
    answer: 'No cuts and bulges, 1.6mm of tread depth across the central three-quarters of the breadth of the tyre, and around the entire outer circumference of the tyre.',
  },
  {
    id: 'tm5',
    question: "Tell me how you'd check that the headlights and tail lights are working. You don't need to exit the vehicle.",
    answer: "Explain you'd operate the switch (turn on ignition if necessary), then walk round the vehicle. As this is a 'tell me' question, you don't need to physically check the lights.",
  },
  {
    id: 'tm6',
    question: "Tell me how you'd know if there was a problem with your anti-lock braking system.",
    answer: 'A warning light should illuminate if there is a fault with the anti-lock braking system.',
  },
  {
    id: 'tm7',
    question: "Tell me how you'd check the direction indicators are working. You don't need to exit the vehicle.",
    answer: "Explain you'd operate the switch (turn on ignition if necessary), then walk round the vehicle. As this is a 'tell me' question, you don't need to physically check the lights.",
  },
  {
    id: 'tm8',
    question: "Tell me how you'd check the brake lights are working on this car.",
    answer: "Explain you'd operate the brake pedal, make use of reflections in windows or doors, or ask someone to help.",
  },
  {
    id: 'tm9',
    question: "Tell me how you'd check the power-assisted steering is working before starting a journey.",
    answer: 'If the steering becomes heavy, the system may not be working properly. Gentle pressure on the steering wheel, maintained while the engine is started, should result in a slight but noticeable movement as the system begins to operate — or turning the wheel just after moving off will give an immediate indication that the power assistance is functioning.',
  },
  {
    id: 'tm10',
    question: "Tell me how you'd switch on the rear fog light(s) and explain when you'd use it/them. You don't need to exit the vehicle.",
    answer: 'Operate the switch (turn on dipped headlights and ignition if necessary), check the warning light is on, and explain when you would use it (e.g. in fog or seriously reduced visibility).',
  },
  {
    id: 'tm11',
    question: "Tell me how you switch your headlight from dipped to main beam and explain how you'd know the main beam is on.",
    answer: 'Operate the switch (with ignition or engine on if necessary), and check with the main beam warning light on the dashboard.',
  },
  {
    id: 'tm12',
    question: "Open the bonnet and tell me how you'd check that the engine has sufficient oil.",
    answer: 'Identify the dipstick or oil level indicator, and describe checking the oil level against the minimum and maximum markers.',
    requiresBonnetOpen: true,
  },
  {
    id: 'tm13',
    question: "Open the bonnet and tell me how you'd check that the engine has sufficient engine coolant.",
    answer: 'Identify the high and low level markings on the header tank (where fitted) or radiator filler cap, and describe how to top up to the correct level.',
    requiresBonnetOpen: true,
  },
  {
    id: 'tm14',
    question: "Open the bonnet and tell me how you'd check that you have a safe level of hydraulic brake fluid.",
    answer: 'Identify the reservoir, and check the level against the high and low markings.',
    requiresBonnetOpen: true,
  },
];

export const SHOW_ME_QUESTIONS: ShowMeTellMeQuestion[] = [
  {
    id: 'sm1',
    question: "When it's safe to do so, can you show me how you wash and clean the rear windscreen?",
    answer: 'Operate the rear windscreen washer and wiper (or wipe manually if the car has no rear wiper) while safely in control of the vehicle.',
  },
  {
    id: 'sm2',
    question: "When it's safe to do so, can you show me how you wash and clean the front windscreen?",
    answer: 'Operate the windscreen washer and wiper while safely in control of the vehicle.',
  },
  {
    id: 'sm3',
    question: "When it's safe to do so, can you show me how you'd switch on your dipped headlights?",
    answer: 'Operate the headlight switch/stalk to dipped beam and confirm the dashboard light is showing dipped, not main, beam.',
  },
  {
    id: 'sm4',
    question: "When it's safe to do so, can you show me how you'd set the rear demister?",
    answer: 'Operate the rear demister control (heated rear window).',
  },
  {
    id: 'sm5',
    question: "When it's safe to do so, can you show me how you'd operate the horn?",
    answer: 'Sound the horn briefly and safely.',
  },
  {
    id: 'sm6',
    question: "When it's safe to do so, can you show me how you'd demist the front windscreen?",
    answer: 'Operate the front demist/air conditioning controls to direct air at the windscreen.',
  },
  {
    id: 'sm7',
    question: "When it's safe to do so, can you show me how you'd open and close the side window?",
    answer: 'Open and close a side window using the control, while keeping the car safely under control.',
  },
];
