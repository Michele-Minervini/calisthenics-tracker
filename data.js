/* ============================================================
   Big Six Tracker — exercise data
   Six movement families, ten progressive steps each.
   Standards: [Beginner, Intermediate, Progression] —
   the 10th step's third standard is the Elite standard.
   ============================================================ */

const AREAS = [
  {
    id: "pushup",
    name: "Pushups",
    icon: "&#x1F4AA;",
    tagline: "Chest, shoulders and triceps — horizontal pressing power.",
    steps: [
      {
        name: "Wall Pushups",
        standards: [
          { label: "Beginner", target: "1 set of 10" },
          { label: "Intermediate", target: "2 sets of 25" },
          { label: "Progression", target: "3 sets of 50" }
        ],
        how: [
          "Stand facing a wall, feet together, palms flat on the wall at chest height, arms straight and shoulder width apart.",
          "Bend at the elbows and shoulders until your forehead gently touches the wall.",
          "Press back to straight arms. Keep the whole body in one line throughout."
        ],
        why: "The gentlest pushup. It grooves perfect technique and rebuilds shoulders, elbows and wrists after injury or a long layoff.",
        easier: "Nearly everyone can do this one. If you are rehabbing, use it as a gentle tester and shorten the range if anything hurts."
      },
      {
        name: "Incline Pushups",
        standards: [
          { label: "Beginner", target: "1 set of 10" },
          { label: "Intermediate", target: "2 sets of 20" },
          { label: "Progression", target: "3 sets of 40" }
        ],
        how: [
          "Find a sturdy object about half your height (kitchen counter, desk, solid chair back) so your body leans at roughly 45 degrees.",
          "Feet together, hands on the edge shoulder width apart, body straight from head to heels.",
          "Lower until your torso lightly touches the edge, pause, press back up."
        ],
        why: "A steeper angle than the wall means your arms move more of your bodyweight — the bridge between standing and floor pushups.",
        easier: "Use a higher support (more upright is easier). Progress by choosing lower and lower surfaces, like steps on a staircase."
      },
      {
        name: "Kneeling Pushups",
        standards: [
          { label: "Beginner", target: "1 set of 10" },
          { label: "Intermediate", target: "2 sets of 15" },
          { label: "Progression", target: "3 sets of 30" }
        ],
        how: [
          "Kneel with palms on the floor under your chest, arms straight and shoulder width apart; cross one ankle over the other.",
          "Keep hips locked in line with trunk and head — no sagging or piking.",
          "Pivoting on the knees, lower until your chest is about one fist's width from the floor, pause, press back up."
        ],
        why: "The first pushup done on the floor — the link between standing pushups and the real thing.",
        easier: "Shorten the range of motion: do about twenty comfortable partial reps and add an inch of depth every workout."
      },
      {
        name: "Half Pushups",
        standards: [
          { label: "Beginner", target: "1 set of 8" },
          { label: "Intermediate", target: "2 sets of 12" },
          { label: "Progression", target: "2 sets of 25" }
        ],
        how: [
          "Full pushup position: hands under upper chest, legs straight and together, back, hips and legs locked in one line.",
          "Lower until your elbows form a right angle — half the depth of a full pushup.",
          "A classic trick: put a basketball under your hips; lightly touch it each rep as an objective depth marker.",
          "Pause at the bottom, then press forcefully back up."
        ],
        why: "Teaches the waist and spine to keep the hips locked — weak hips are why most people's pushups look ugly.",
        easier: "Do quarter pushups with the ball under your knees instead, then move the ball up the thighs toward the hips over time."
      },
      {
        name: "Full Pushups",
        standards: [
          { label: "Beginner", target: "1 set of 5" },
          { label: "Intermediate", target: "2 sets of 10" },
          { label: "Progression", target: "2 sets of 20" }
        ],
        how: [
          "The classic: hands shoulder width under the upper chest, body one straight line from head to heels.",
          "Lower until your chest is one fist's width from the floor — a baseball or tennis ball under the chest makes a perfect depth gauge.",
          "Pause, then push back up smoothly. About two seconds down, two seconds up."
        ],
        why: "The benchmark upper-body exercise, working chest, shoulders and triceps together.",
        easier: "Go back to half pushups with the basketball under the hips and move the ball a few inches toward your chest each workout until your jaw touches it at the bottom."
      },
      {
        name: "Close Pushups",
        standards: [
          { label: "Beginner", target: "1 set of 5" },
          { label: "Intermediate", target: "2 sets of 10" },
          { label: "Progression", target: "2 sets of 20" }
        ],
        how: [
          "Full pushup position but with the hands touching — index fingertips in contact is enough, no need for a 'diamond'.",
          "Lower until your chest gently touches the backs of your hands.",
          "Pause, then press back up without letting the elbows flare wildly."
        ],
        why: "Shifts the load onto the triceps and elbows — exactly the strength that one-arm pushups will demand later.",
        easier: "Return to full pushups and move the hands an inch or two closer every workout, keeping reps high."
      },
      {
        name: "Uneven Pushups",
        perSide: true,
        standards: [
          { label: "Beginner", target: "1 set of 5 (each side)" },
          { label: "Intermediate", target: "2 sets of 10 (each side)" },
          { label: "Progression", target: "2 sets of 20 (each side)" }
        ],
        how: [
          "Pushup position with one hand flat on the floor and the other on a basketball, both hands under the shoulders.",
          "Spread your weight as evenly as you can, lower until your chest touches the hand on the ball, then press up.",
          "Work both sides equally in every session."
        ],
        why: "The first move toward one-arm strength. Stabilizing the wobbling ball switches on the rotator cuff muscles that protect your shoulders later.",
        easier: "Use a flat brick instead of the ball. Progress from one brick to two, then three stacked, then try the basketball again."
      },
      {
        name: "½ One-Arm Pushups",
        perSide: true,
        standards: [
          { label: "Beginner", target: "1 set of 5 (each side)" },
          { label: "Intermediate", target: "2 sets of 10 (each side)" },
          { label: "Progression", target: "2 sets of 20 (each side)" }
        ],
        how: [
          "Half pushup position with a basketball under your hips; one hand on the floor under your breastbone, the other hand in the small of your back.",
          "Lower until your hips touch the ball, pause, press back up.",
          "Do not let the torso twist — the whole body stays square and straight."
        ],
        why: "Your first taste of one-sided pressing: it teaches the balance and body position that full one-arm pushups require.",
        easier: "Start with quarter one-arm pushups (ball under the knees) and move the ball forward over time, exactly as in Step 4."
      },
      {
        name: "Lever Pushups",
        perSide: true,
        standards: [
          { label: "Beginner", target: "1 set of 5 (each side)" },
          { label: "Intermediate", target: "2 sets of 10 (each side)" },
          { label: "Progression", target: "2 sets of 20 (each side)" }
        ],
        how: [
          "One hand flat on the floor directly under your breastbone; the other arm straight out to the side, palm resting on a basketball as far away as you can reach.",
          "Lower slowly until your chest is one fist's width from the floor — the ball will roll further out as you descend.",
          "Pause at the bottom, then push back up."
        ],
        why: "With the side arm nearly useless for pushing, the working arm carries almost everything — this is nearly as hard as a one-arm pushup.",
        easier: "Bend the elbow of the ball arm to bring the ball closer to your body (but not underneath you), then straighten it out again as you get stronger."
      },
      {
        name: "One-Arm Pushups",
        master: true,
        perSide: true,
        standards: [
          { label: "Beginner", target: "1 set of 5 (each side)" },
          { label: "Intermediate", target: "2 sets of 10 (each side)" },
          { label: "Elite", target: "1 set of 100 (each side)" }
        ],
        how: [
          "One palm on the floor directly below your chest, legs stretched out behind on the toes, free hand in the small of your back.",
          "Keep spine and hips aligned and the body square — no twisting, no splayed legs.",
          "Lower under full control until your jaw is about one fist's width from the floor, pause, press back up."
        ],
        why: "The tenth and final step: the gold standard of pressing strength, done with pure form.",
        easier: "If five clean reps are out of reach, go back to lever pushups until you can do twenty (even thirty) perfect reps, then try again."
      }
    ]
  },
  {
    id: "squat",
    name: "Squats",
    icon: "&#x1F9B5;",
    tagline: "Legs and hips — the foundation of total-body power.",
    steps: [
      {
        name: "Shoulderstand Squats",
        standards: [
          { label: "Beginner", target: "1 set of 10" },
          { label: "Intermediate", target: "2 sets of 25" },
          { label: "Progression", target: "3 sets of 50" }
        ],
        how: [
          "Lie on your back and kick up into a shoulderstand, hands supporting your lower back, weight on shoulders and upper arms — never on the neck.",
          "Keeping the torso upright, bend at hips and knees until your knees touch your forehead.",
          "Extend the legs straight back up to the locked position and repeat."
        ],
        why: "The squat movement with almost no load through knees or lower back — the perfect starting point and a great rehab drill.",
        easier: "If your knees can't reach your forehead yet, go as deep as you comfortably can and add depth each workout."
      },
      {
        name: "Jackknife Squats",
        standards: [
          { label: "Beginner", target: "1 set of 10" },
          { label: "Intermediate", target: "2 sets of 20" },
          { label: "Progression", target: "3 sets of 40" }
        ],
        how: [
          "Stand in front of a sturdy knee-high object (chair seat, low table). Hinge at the hips and place your palms on it, tilting forward so your arms carry part of your weight.",
          "Feet shoulder width, torso staying roughly parallel to the floor, squat down until your hamstrings meet your calves.",
          "Push back up with legs and arms together. Heels stay flat the whole time."
        ],
        why: "About half as hard as a normal squat: it builds full-depth mobility and prepares knees and Achilles tendons for what's coming.",
        easier: "Add squat depth an inch at a time, or lean more weight on your arms and gradually shift the work back to the legs."
      },
      {
        name: "Supported Squats",
        standards: [
          { label: "Beginner", target: "1 set of 10" },
          { label: "Intermediate", target: "2 sets of 15" },
          { label: "Progression", target: "3 sets of 30" }
        ],
        how: [
          "Stand upright holding a sturdy object (desk edge, chair back) with straight-ish arms angled down, feet shoulder width.",
          "Squat all the way down — back straight, heels flat — until your hamstrings rest on your calves.",
          "Stand back up mostly with leg power, pulling lightly with the arms to help, especially out of the bottom."
        ],
        why: "The link between arm-assisted and free squatting: full depth, with just enough help where you need it.",
        easier: "Simply pull harder with the arms when needed, and use less arm help every session as the legs take over."
      },
      {
        name: "Half Squats",
        standards: [
          { label: "Beginner", target: "1 set of 8" },
          { label: "Intermediate", target: "2 sets of 35" },
          { label: "Progression", target: "2 sets of 50" }
        ],
        how: [
          "Stand free, feet shoulder width or a little wider, toes pointing slightly out, hands wherever comfortable.",
          "Squat until your thighs are parallel to the floor (knees at about ninety degrees).",
          "Pause dead at the bottom — no bouncing — then stand under full control. Back straight, heels down, knees tracking over the toes."
        ],
        why: "Your first unassisted squat: it teaches balance and the knee and foot positions that suit your build.",
        easier: "Start with quarter squats and add an inch of depth whenever you can."
      },
      {
        name: "Full Squats",
        standards: [
          { label: "Beginner", target: "1 set of 5" },
          { label: "Intermediate", target: "2 sets of 10" },
          { label: "Progression", target: "2 sets of 30" }
        ],
        how: [
          "Same stance as half squats. Squat down keeping the back straight; as your thighs pass parallel, sit back as if lowering into a chair.",
          "Descend under control until the backs of your thighs rest on your calves.",
          "Pause, then drive back up with leg strength alone — no bounce, heels flat, knees never caving inward."
        ],
        why: "The classic bodyweight leg builder: thighs, glutes, hips, calves and even the feet all get stronger.",
        easier: "Return to half squats and add an inch of depth as you get stronger. Expect the very bottom to be the hard part."
      },
      {
        name: "Close Squats",
        standards: [
          { label: "Beginner", target: "1 set of 5" },
          { label: "Intermediate", target: "2 sets of 10" },
          { label: "Progression", target: "2 sets of 20" }
        ],
        how: [
          "Stand with your heels together, toes angled slightly out, arms straight out in front of your chest as a counterbalance.",
          "Squat to full depth until your chest presses into your thighs.",
          "Flex the shins and pull the toes up to avoid tipping backwards; stand back up with leg power only, heels down."
        ],
        why: "Full squats with the quadriceps turned up to maximum — and a serious balance challenge.",
        easier: "From full squats, bring the feet an inch closer together every workout. If you tip backwards, the shin muscles just need time to catch up."
      },
      {
        name: "Uneven Squats",
        perSide: true,
        standards: [
          { label: "Beginner", target: "1 set of 5 (each side)" },
          { label: "Intermediate", target: "2 sets of 10 (each side)" },
          { label: "Progression", target: "2 sets of 20 (each side)" }
        ],
        how: [
          "One foot flat on the floor, the other resting on a basketball about one foot-length ahead, feet roughly shoulder width apart, arms out front.",
          "Squat until the hamstring of your floor leg touches its calf; the ball leg helps only a little.",
          "Push back up with both legs, but let the floor leg do the real work. Keep clear space behind you in case you tip."
        ],
        why: "The first big step toward one-leg strength: the raised leg can't contribute much, so the grounded leg learns to carry you.",
        easier: "Swap the wobbly ball for three stacked flat bricks; or start with one brick and build up the height."
      },
      {
        name: "½ One-Leg Squats",
        perSide: true,
        standards: [
          { label: "Beginner", target: "1 set of 5 (each side)" },
          { label: "Intermediate", target: "2 sets of 10 (each side)" },
          { label: "Progression", target: "2 sets of 20 (each side)" }
        ],
        how: [
          "Stand on one leg with the other leg held straight out in front, foot around thigh height, arms out in front of your chest.",
          "Squat on the standing leg until the knee reaches about ninety degrees (thigh parallel to the floor).",
          "Pause under tension, then drive back up on that single leg. Back flat, heel down."
        ],
        why: "Your first true one-leg squat: it builds the balance, and the hip strength to hold the free leg up.",
        easier: "Shorten the range of motion and add depth gradually over time."
      },
      {
        name: "Assisted One-Leg Squats",
        perSide: true,
        standards: [
          { label: "Beginner", target: "1 set of 5 (each side)" },
          { label: "Intermediate", target: "2 sets of 10 (each side)" },
          { label: "Progression", target: "2 sets of 20 (each side)" }
        ],
        how: [
          "Place a basketball beside the working leg. Stand on that leg with the other held out front, as in the previous step.",
          "Squat all the way down until the hamstring rests on the calf, placing your hand on the ball at the bottom.",
          "Stand up mostly with leg strength, pressing down on the ball only to get through the first few inches."
        ],
        why: "The bottom inches of a one-leg squat are the hardest in all of squatting — this step lets your arm spot you exactly there.",
        easier: "Press off something higher than the ball (a chair seat, a low table), then work down to progressively smaller objects."
      },
      {
        name: "One-Leg Squats",
        master: true,
        perSide: true,
        standards: [
          { label: "Beginner", target: "1 set of 5 (each side)" },
          { label: "Intermediate", target: "2 sets of 10 (each side)" },
          { label: "Elite", target: "2 sets of 50 (each side)" }
        ],
        how: [
          "Stand tall, raise one leg straight out until the foot is around hip level, arms out in front of your chest.",
          "Lower yourself smoothly on the standing leg — never just drop — until the hamstring compresses fully against the calf.",
          "Pause for a one-count under tension, then stand back up with pure leg strength. No momentum, back straight, heel flat."
        ],
        why: "The tenth and final step: the ultimate lower-body exercise, building legs that are as functional as they look.",
        easier: "Go back to assisted one-leg squats with a smaller object (like stacked bricks) and shrink it until you need no help at all."
      }
    ]
  },
  {
    id: "pullup",
    name: "Pullups",
    icon: "&#x1F9D7;",
    tagline: "Back, lats and biceps — pulling your own weight, literally.",
    steps: [
      {
        name: "Vertical Pulls",
        standards: [
          { label: "Beginner", target: "1 set of 10" },
          { label: "Intermediate", target: "2 sets of 20" },
          { label: "Progression", target: "3 sets of 40" }
        ],
        how: [
          "Stand with your toes 3–6 inches from a doorframe or sturdy vertical rail and grip it at about shoulder width.",
          "Lean back until your arms are nearly straight and you feel a gentle stretch across the upper back.",
          "Pull yourself back in by squeezing the shoulder blades together and bending the arms."
        ],
        why: "A very gentle re-introduction to pulling: it restores blood flow and grooves the movement after injury or inactivity.",
        easier: "Almost everyone can do these. If rehabbing, reduce the lean and keep the range short."
      },
      {
        name: "Horizontal Pulls",
        standards: [
          { label: "Beginner", target: "1 set of 10" },
          { label: "Intermediate", target: "2 sets of 20" },
          { label: "Progression", target: "3 sets of 30" }
        ],
        how: [
          "Slide under a sturdy table or desk at least hip height and grip the edge overhand, about shoulder width.",
          "Body tense and straight, weight on hands and heels only.",
          "Pull your chest up to the edge, pause, then lower under control."
        ],
        why: "A steeper angle than vertical pulls: real strength work that conditions elbows and shoulders for the bar.",
        easier: "The higher the surface, the easier the pull. Find something above hip height first, and return once you can do thirty reps."
      },
      {
        name: "Jackknife Pulls",
        standards: [
          { label: "Beginner", target: "1 set of 10" },
          { label: "Intermediate", target: "2 sets of 15" },
          { label: "Progression", target: "3 sets of 20" }
        ],
        how: [
          "Hang from a bar (overhand, shoulder width, shoulders 'tight' — never fully relaxed) with your calves resting on a high chair back or similar in front of you, legs straight, feet around pelvis height.",
          "Pull your chin over the bar, pressing down through the legs to help.",
          "Lower under control. Dismount carefully and never work to grip failure."
        ],
        why: "The full pullup motion, with your legs taking just enough weight to make it achievable.",
        easier: "The bottom is the hard part: start near the top with bent arms and add depth as you get stronger."
      },
      {
        name: "Half Pullups",
        standards: [
          { label: "Beginner", target: "1 set of 8" },
          { label: "Intermediate", target: "2 sets of 11" },
          { label: "Progression", target: "2 sets of 15" }
        ],
        how: [
          "Hang from a bar, overhand grip, shoulder width or slightly wider, feet clear of the floor, ankles crossed behind you.",
          "Start with your elbows bent at right angles, upper arms parallel to the floor (jump or step up to get there).",
          "Pull until your chin clears the bar, pause, then lower back to the halfway point. Shoulders stay tight, legs stay still."
        ],
        why: "The first time your arms and back move your entire bodyweight — more than most people can row.",
        easier: "Reduce the range and stay nearer the bar. Carrying less body fat makes an enormous difference from this step on."
      },
      {
        name: "Full Pullups",
        standards: [
          { label: "Beginner", target: "1 set of 5" },
          { label: "Intermediate", target: "2 sets of 8" },
          { label: "Progression", target: "2 sets of 10" }
        ],
        how: [
          "Hang with a slight kink in the elbows (never fully slack), shoulders tight, ankles crossed behind.",
          "Pull smoothly until your chin passes over the bar — about two seconds up.",
          "Pause, then lower under full control for two seconds. No kipping, no swinging."
        ],
        why: "The classic test of relative strength: a person who cannot pull up their own body cannot call themselves strong.",
        easier: "Rest one foot on a chair and press down just enough to get out of the bottom. Use less foot pressure every session."
      },
      {
        name: "Close Pullups",
        standards: [
          { label: "Beginner", target: "1 set of 5" },
          { label: "Intermediate", target: "2 sets of 8" },
          { label: "Progression", target: "2 sets of 10" }
        ],
        how: [
          "Same strict pullup, but with the hands together — at most four inches apart if a very close grip bothers your joints.",
          "Pull your chin over the bar, pause, lower slowly.",
          "Feel free to use a side-on or underhand grip: the arms naturally want to rotate on this one."
        ],
        why: "The close grip robs the big back muscles of leverage and forces the biceps and arms — the weak link in one-arm pullups — to grow strong.",
        easier: "From full pullups, bring the hands an inch closer every workout."
      },
      {
        name: "Uneven Pullups",
        perSide: true,
        standards: [
          { label: "Beginner", target: "1 set of 5 (each side)" },
          { label: "Intermediate", target: "2 sets of 7 (each side)" },
          { label: "Progression", target: "2 sets of 9 (each side)" }
        ],
        how: [
          "Grip the bar with one hand (side-on or underhand is most comfortable); with the free hand, grip the wrist of the working arm, thumb under your palm.",
          "Feet off the floor, ankles crossed behind, shoulders braced.",
          "Pull your chin over the bar, pause, lower slowly. Train both sides equally."
        ],
        why: "The bar arm does most of the work while the wrist arm assists — the doorway into one-arm territory.",
        easier: "If holding the bar one-handed is the problem, add one-hand hangs after your pullup work to build grip."
      },
      {
        name: "½ One-Arm Pullups",
        perSide: true,
        standards: [
          { label: "Beginner", target: "1 set of 4 (each side)" },
          { label: "Intermediate", target: "2 sets of 6 (each side)" },
          { label: "Progression", target: "2 sets of 8 (each side)" }
        ],
        how: [
          "One hand on the bar in your strongest grip (a hanging ring is ideal); the free arm wherever it doesn't interfere — out to the side or behind your back.",
          "Set up with the working elbow at a right angle, upper arm parallel to the floor (jump, kip or step up to get there).",
          "Pull your chin over the bar, pause, lower only to the halfway point, and repeat."
        ],
        why: "Half the range, all of your weight, one arm: this builds the muscle and the nerve for the full movement.",
        easier: "Work the top few inches near the bar and add depth inch by inch. Follow it with a full-range exercise like close pullups, since this one skips the stretched position."
      },
      {
        name: "Assisted One-Arm Pullups",
        perSide: true,
        standards: [
          { label: "Beginner", target: "1 set of 3 (each side)" },
          { label: "Intermediate", target: "2 sets of 5 (each side)" },
          { label: "Progression", target: "2 sets of 7 (each side)" }
        ],
        how: [
          "Throw a towel over the bar. One hand grips the bar; the other grips the towel at about eye level.",
          "Pull up, helping with the towel hand for the first half; at the halfway point release the towel and finish the top half with one arm.",
          "Lower on the single arm, catching the towel again at the bottom. Repeat."
        ],
        why: "Lets you attack the brutal bottom half of the one-arm pullup with exactly as much help as you need — and builds the tendons for the real thing.",
        easier: "Grip the towel higher (nearer the bar) for more help; move your grip lower as you get stronger, until you're barely using it."
      },
      {
        name: "One-Arm Pullups",
        master: true,
        perSide: true,
        standards: [
          { label: "Beginner", target: "1 set of 1 (each side)" },
          { label: "Intermediate", target: "2 sets of 3 (each side)" },
          { label: "Elite", target: "2 sets of 6 (each side)" }
        ],
        how: [
          "One hand squeezes the bar in your strongest grip, body tensed, shoulder set tight, slight kink in the arm, ankles crossed behind.",
          "Pull with as little momentum as possible until your chin clears the bar.",
          "Pause, lower smoothly, and repeat — if you can. Almost nobody on earth does these clean."
        ],
        why: "The tenth and final step: the greatest back and arm exercise there is.",
        easier: "Milk Step 9 for months first. Aim for one single perfect rep, then consolidate before chasing more."
      }
    ]
  },
  {
    id: "legraise",
    name: "Leg Raises",
    icon: "&#x1F525;",
    tagline: "Abs, waist and hip flexors — a midsection with real strength.",
    steps: [
      {
        name: "Knee Tucks",
        standards: [
          { label: "Beginner", target: "1 set of 10" },
          { label: "Intermediate", target: "2 sets of 25" },
          { label: "Progression", target: "3 sets of 40" }
        ],
        how: [
          "Sit on the edge of a chair or bench, lean back slightly and grip the edge. Legs straight, feet together, heels a few inches off the floor.",
          "Smoothly draw the knees up and in until they are 6–10 inches from your chest, exhaling fully so the abs finish tightly contracted.",
          "Pause, then extend the legs back out — feet never touch the floor until the set is done. Slow reps; take extra breaths between reps if needed."
        ],
        why: "The ideal beginner midsection drill: it builds posture, ab strength and the habit of smooth, controlled reps.",
        easier: "Shorten the range in the middle of the movement and lengthen it as your waist gets stronger."
      },
      {
        name: "Flat Knee Raises",
        standards: [
          { label: "Beginner", target: "1 set of 10" },
          { label: "Intermediate", target: "2 sets of 20" },
          { label: "Progression", target: "3 sets of 35" }
        ],
        how: [
          "Lie flat, arms by your sides pressing the floor, knees bent at ninety degrees, feet an inch or two up.",
          "Raise the knees over the hips until thighs are vertical and calves parallel to the floor, exhaling on the way up.",
          "Keep the knee angle locked; lower back without the feet ever touching down."
        ],
        why: "Moves the ab work to the floor, adding hip flexor strength in preparation for hanging work.",
        easier: "Rest the feet on the floor between reps at first, and phase that out as you get stronger."
      },
      {
        name: "Flat Bent Leg Raises",
        standards: [
          { label: "Beginner", target: "1 set of 10" },
          { label: "Intermediate", target: "2 sets of 15" },
          { label: "Progression", target: "3 sets of 30" }
        ],
        how: [
          "Same position, but the knees are bent at only about forty-five degrees.",
          "Raise the feet over the pelvis in about two seconds, keeping the knee angle frozen the whole way.",
          "Pause, lower, pause, repeat. Abs tight, feet never touching the floor."
        ],
        why: "Straighter legs mean longer levers: the same movement, meaningfully harder.",
        easier: "Start closer to a ninety-degree bend and straighten the legs a little more every week."
      },
      {
        name: "Flat Frog Raises",
        standards: [
          { label: "Beginner", target: "1 set of 8" },
          { label: "Intermediate", target: "2 sets of 15" },
          { label: "Progression", target: "3 sets of 25" }
        ],
        how: [
          "Raise the legs as in the previous step (bent 45°); at the top, straighten them fully so they point at the ceiling.",
          "Lower the dead-straight legs slowly — a four-second count — until the heels are an inch or two from the floor.",
          "Bend the knees again and repeat. Exhale up, inhale down."
        ],
        why: "You are stronger lowering than lifting: frog raises exploit that to build straight-leg strength you don't yet have on the way up.",
        easier: "Work the top of the movement first and add lowering depth over time."
      },
      {
        name: "Flat Straight Leg Raises",
        standards: [
          { label: "Beginner", target: "1 set of 5" },
          { label: "Intermediate", target: "2 sets of 10" },
          { label: "Progression", target: "2 sets of 20" }
        ],
        how: [
          "Lie flat, legs dead straight and together, feet an inch or two off the floor, hands pressing the floor by your sides.",
          "Raise the locked legs in at least two seconds until they point straight up over your pelvis, exhaling and keeping the abs tight.",
          "Reverse just as slowly. Knees never unlock; heels never touch down mid-set."
        ],
        why: "A military and martial-arts staple: stomach and hip power with flexibility built in — if the knees stay locked.",
        easier: "Go back to frog raises until you own 3×30, or keep the legs straight and work shorter top-range reps, adding depth over time."
      },
      {
        name: "Hanging Knee Raises",
        standards: [
          { label: "Beginner", target: "1 set of 5" },
          { label: "Intermediate", target: "2 sets of 10" },
          { label: "Progression", target: "2 sets of 15" }
        ],
        how: [
          "Hang from a bar, hands shoulder width, shoulders tight, body straight, feet just clear of the floor.",
          "Smoothly raise the knees until they are level with your pelvis, thighs parallel to the floor, exhaling with the stomach pulled in.",
          "Pause, lower to a full hang, and repeat without any swinging."
        ],
        why: "Fighting gravity from a dead hang transforms midsection strength quickly — and the hang itself builds grip and ribcage muscles.",
        easier: "Work the top range and add depth over time. Whatever you do, never swing: momentum builds nothing."
      },
      {
        name: "Hanging Bent Leg Raises",
        standards: [
          { label: "Beginner", target: "1 set of 5" },
          { label: "Intermediate", target: "2 sets of 10" },
          { label: "Progression", target: "2 sets of 15" }
        ],
        how: [
          "Hang with shoulders tight; bend the knees about forty-five degrees, feet a little behind your body.",
          "Moving only at the hips, raise the feet to pelvis height, keeping the knee angle locked.",
          "Pause, lower, repeat. Exhale up, inhale down, abs tense throughout."
        ],
        why: "Longer levers again: the hardest midsection work so far, hitting abs, obliques and hip flexors together.",
        easier: "Bend the knees closer to ninety degrees and extend them gradually. Don't let the angle open on the way down — that's what causes swinging."
      },
      {
        name: "Hanging Frog Raises",
        standards: [
          { label: "Beginner", target: "1 set of 5" },
          { label: "Intermediate", target: "2 sets of 10" },
          { label: "Progression", target: "2 sets of 15" }
        ],
        how: [
          "Raise the legs exactly as in hanging bent leg raises.",
          "At the top, extend the legs straight out so they are parallel to the floor.",
          "Lower the straight legs under control to a full hang, re-bend, and repeat."
        ],
        why: "The same negative-first trick as flat frog raises, applied to the bar — the stepping stone to straight-leg hanging work.",
        easier: "If it's flexibility (not strength) holding you back, stretch the hamstrings and lower back for a few minutes first."
      },
      {
        name: "Partial Straight Leg Raises",
        standards: [
          { label: "Beginner", target: "1 set of 5" },
          { label: "Intermediate", target: "2 sets of 10" },
          { label: "Progression", target: "2 sets of 15" }
        ],
        how: [
          "Hang with shoulders tight; lift the locked legs to about forty-five degrees and hold — that's your start position.",
          "Raise the straight legs until they are parallel with the floor.",
          "Pause, lower only back to forty-five degrees, and repeat. Abs on the whole set."
        ],
        why: "Trains the top half of the hardest ab exercise there is, so the full version stops being impossible.",
        easier: "Work near the very top — even a few inches of travel counts — and extend downward as you strengthen."
      },
      {
        name: "Hanging Straight Leg Raises",
        master: true,
        standards: [
          { label: "Beginner", target: "1 set of 5" },
          { label: "Intermediate", target: "2 sets of 10" },
          { label: "Elite", target: "2 sets of 30" }
        ],
        how: [
          "Dead hang from the bar, shoulders tight, body straight, feet just off the floor.",
          "Raise the locked legs in at least two seconds until they are parallel with the floor, exhaling all your air so the abs fully contract.",
          "Pause, then lower just as slowly to a dead hang. Stay flexed even at the bottom. Pure muscle — zero swing."
        ],
        why: "The tenth and final step: the greatest all-round midsection exercise in existence, done strictly.",
        easier: "Own Step 9 first, then simply add downward depth a fraction of an inch at a time."
      }
    ]
  },
  {
    id: "bridge",
    name: "Bridges",
    icon: "&#x1F309;",
    tagline: "Spine, hips and the whole back chain — armor for your back.",
    steps: [
      {
        name: "Short Bridges",
        standards: [
          { label: "Beginner", target: "1 set of 10" },
          { label: "Intermediate", target: "2 sets of 25" },
          { label: "Progression", target: "3 sets of 50" }
        ],
        how: [
          "Lie on your back, feet flat and drawn in so the heels are 6–8 inches from your glutes, shoulder width apart; hands crossed on your stomach.",
          "Push through the feet and lift the hips until knees, hips and shoulders form one straight line — no sagging.",
          "Pause at the top, lower, repeat. Exhale up, inhale down."
        ],
        why: "The gentlest way to wake up the spinal muscles and glutes, with almost no pressure on the back itself.",
        easier: "Recovering from a back problem? Put a couple of cushions under your hips to shorten the range."
      },
      {
        name: "Straight Bridges",
        standards: [
          { label: "Beginner", target: "1 set of 10" },
          { label: "Intermediate", target: "2 sets of 20" },
          { label: "Progression", target: "3 sets of 40" }
        ],
        how: [
          "Sit with legs straight out, feet shoulder width; palms on the floor beside your hips, fingers pointing toward the toes.",
          "Press through the hands and push the hips up until legs and torso form one straight line from heels to shoulders.",
          "Chin up, eyes to the ceiling; pause, lower, repeat."
        ],
        why: "Adds the arms into bridging and strengthens the often-ignored muscles between the shoulder blades.",
        easier: "Do it with bent knees (like short bridges), or from kneeling, pressing the hips up just a few inches."
      },
      {
        name: "Angled Bridges",
        standards: [
          { label: "Beginner", target: "1 set of 8" },
          { label: "Intermediate", target: "2 sets of 15" },
          { label: "Progression", target: "3 sets of 30" }
        ],
        how: [
          "Sit on the edge of a bed, then lie back with the hips off the edge, feet flat on the floor shoulder width apart.",
          "Place the hands beside your head, fingers pointing toward your feet, and press up until head and torso lift clear, back arched.",
          "Let the head tilt back so you can see the wall behind you; lower until you're resting on the bed again, and repeat."
        ],
        why: "Introduces the hands-by-the-head position of true bridging, opening the shoulders and strengthening the wrists.",
        easier: "The higher the surface, the easier the move: start from a table or desk and work down to bed height."
      },
      {
        name: "Head Bridges",
        standards: [
          { label: "Beginner", target: "1 set of 8" },
          { label: "Intermediate", target: "2 sets of 15" },
          { label: "Progression", target: "2 sets of 25" }
        ],
        how: [
          "From the floor, feet drawn in, hands beside the head, push up into a full arch (a bridge hold).",
          "Bend arms and legs until the crown of your skull touches the floor with feather-light pressure — never bang the head.",
          "Press back up to the arch. Keep the deep arch the whole set, breathing as normally as you can."
        ],
        why: "A short-range bridge that builds the arch, the wrists and the confidence for full bridging.",
        easier: "Start lying over a stack of cushions under the small of your back, or shorten the range and add depth workout by workout."
      },
      {
        name: "Half Bridges",
        standards: [
          { label: "Beginner", target: "1 set of 8" },
          { label: "Intermediate", target: "2 sets of 15" },
          { label: "Progression", target: "2 sets of 20" }
        ],
        how: [
          "Place a basketball (with a folded towel on top if it's uncomfortable) under the small of your back; shoulders and feet on the floor, hands beside the head.",
          "Press up to a full arch, then lower until your back just kisses the ball — never rest your weight on it.",
          "Press back up and repeat, breathing steadily."
        ],
        why: "This is the top half of the full bridge — master it and the complete movement is within reach.",
        easier: "Start with a shallow range and extend it session by session."
      },
      {
        name: "Full Bridges",
        standards: [
          { label: "Beginner", target: "1 set of 6" },
          { label: "Intermediate", target: "2 sets of 10" },
          { label: "Progression", target: "2 sets of 15" }
        ],
        how: [
          "Lie on your back, feet drawn in 6–8 inches from the glutes, hands beside the head, elbows pointing up.",
          "Press through arms and legs, lifting the hips high and arching the back until — ideally — the arms are straight and the head tilts back to see the wall behind.",
          "Hold a moment, then lower yourself all the way down under control. That's one rep."
        ],
        why: "The signature exercise of this progression: spinal power, flexibility, open shoulders and a bulletproof back.",
        easier: "Just push as high as you can each rep. Full straight-arm extension arrives with patience, not force."
      },
      {
        name: "Wall Walking Bridges (Down)",
        standards: [
          { label: "Beginner", target: "1 set of 3" },
          { label: "Intermediate", target: "2 sets of 6" },
          { label: "Progression", target: "2 sets of 10" }
        ],
        how: [
          "Stand about an arm's length from a wall, back to it, feet shoulder width.",
          "Push the hips forward, bend backward until you see the wall, and place your palms on it overhead, fingers pointing down.",
          "Walk the hands down the wall one at a time (taking small steps forward as needed) until you land in a full bridge at its base. Sit out of it, stand up — that's one rep."
        ],
        why: "Walking down is easier than up — this teaches the standing-to-bridge pathway safely.",
        easier: "Just go a little lower each session, and take smaller hand-steps — they're easier."
      },
      {
        name: "Wall Walking Bridges (Up)",
        standards: [
          { label: "Beginner", target: "1 set of 2" },
          { label: "Intermediate", target: "2 sets of 4" },
          { label: "Progression", target: "2 sets of 8" }
        ],
        how: [
          "Walk down the wall into a full bridge at its base, as in Step 7.",
          "Now reverse it: press one palm back onto the wall, then the other, and walk upward hand over hand — the floor-to-wall transition is the hardest moment.",
          "Take small steps back toward the wall as you rise, until you're standing free. Down plus up equals one rep."
        ],
        why: "Same flexibility as walking down, but now you're lifting your body against gravity — real back strength.",
        easier: "Only walk down as far as you're certain you can climb back up. Mark your depth (chalk helps) and beat it gradually."
      },
      {
        name: "Closing Bridges",
        standards: [
          { label: "Beginner", target: "1 set of 1" },
          { label: "Intermediate", target: "2 sets of 3" },
          { label: "Progression", target: "2 sets of 6" }
        ],
        how: [
          "Stand with feet shoulder width and generous clear space behind you.",
          "Push the pelvis forward, bend the knees and arch backward, head tilting back — one smooth motion — until you see the floor behind you.",
          "Sweep the arms overhead and keep arching until your palms land softly on the floor in a full bridge. Lie down out of it, stand, repeat."
        ],
        why: "Bridging from a stand with no wall: the controlled lowering half of the final step.",
        easier: "Reach back onto stairs and work a step lower over time. Falling backward onto lucky palms doesn't count — the descent must be controlled."
      },
      {
        name: "Stand-to-Stand Bridges",
        master: true,
        standards: [
          { label: "Beginner", target: "1 set of 1" },
          { label: "Intermediate", target: "2 sets of 3" },
          { label: "Elite", target: "2 sets of 10–30" }
        ],
        how: [
          "Perform a closing bridge down into a full bridge hold.",
          "Shift your weight forward through the thighs, bend the knees, press through the hands to the fingertips — and let the hands leave the floor as you rise.",
          "Draw the arms back over the shoulders, pull the hips in, and stand tall. Down and up is one rep. It's a smooth weight shift, not an explosive push."
        ],
        why: "The tenth and final step: total spinal strength, flexibility, balance and coordination in one movement.",
        easier: "Use the stairs trick for the rising phase too, and a wider stance at first — then narrow it to shoulder width."
      }
    ]
  },
  {
    id: "hspu",
    name: "Handstand Pushups",
    icon: "&#x1F938;",
    tagline: "Shoulders, arms and balance — pressing vertically, upside-down.",
    steps: [
      {
        name: "Wall Headstands",
        timed: true,
        standards: [
          { label: "Beginner", target: "hold 30 seconds" },
          { label: "Intermediate", target: "hold 1 minute" },
          { label: "Progression", target: "hold 2 minutes" }
        ],
        how: [
          "Put a cushion at the base of a solid wall. Kneel, place the crown of your head on it 6–10 inches from the wall, palms flat on either side.",
          "Kick up one leg at a time until your heels find the wall, then straighten out into a line.",
          "Hold, mouth closed, breathing smoothly through the nose. Come down under control."
        ],
        why: "Being upside-down is a skill in itself: this teaches your circulation and your nerves to be calm while inverted.",
        easier: "The kick-up is the hard part, not the hold — ask someone to guide your legs up the first few times."
      },
      {
        name: "Crow Stands",
        timed: true,
        standards: [
          { label: "Beginner", target: "hold 10 seconds" },
          { label: "Intermediate", target: "hold 30 seconds" },
          { label: "Progression", target: "hold 1 minute" }
        ],
        how: [
          "Squat down, palms flat on the floor at shoulder width, arms slightly bent.",
          "Place the knees on the outside of the elbows and tip slowly forward until the feet float off the floor.",
          "Balance there, breathing steadily, then tip gently back to land the toes."
        ],
        why: "Your whole bodyweight balanced on your hands: this builds the wrists, forearms and 'stabilizer' strength that handstands need.",
        easier: "Falling forward? Press hard through the fingertips. Falling backward? Lift the heels up tighter toward your glutes."
      },
      {
        name: "Wall Handstands",
        timed: true,
        standards: [
          { label: "Beginner", target: "hold 30 seconds" },
          { label: "Intermediate", target: "hold 1 minute" },
          { label: "Progression", target: "hold 2 minutes" }
        ],
        how: [
          "Palms on the floor 6–10 inches from the wall, shoulder width, arms straight.",
          "Kick up one leg at a time until both heels rest on the wall together, body slightly arched.",
          "Hold, breathing normally, then come down with control."
        ],
        why: "The full inverted position with straight arms — the platform every handstand pushup is built on.",
        easier: "If the kick-up won't click, practice kicking up off a box or chair first."
      },
      {
        name: "Half Handstand Pushups",
        standards: [
          { label: "Beginner", target: "1 set of 5" },
          { label: "Intermediate", target: "2 sets of 10" },
          { label: "Progression", target: "2 sets of 20" }
        ],
        how: [
          "Kick up into a wall handstand, body braced, heels resting lightly on the wall.",
          "Bend at shoulders and elbows until your head has descended half the distance to the floor — only about six inches of travel.",
          "Pause, then press firmly back to straight arms. Breathe smoothly."
        ],
        why: "The static hold becomes a moving press: this is where the shoulders and triceps really start to grow.",
        easier: "Begin with tiny bends — even a fraction of an inch — building reps first, then depth."
      },
      {
        name: "Handstand Pushups",
        standards: [
          { label: "Beginner", target: "1 set of 5" },
          { label: "Intermediate", target: "2 sets of 10" },
          { label: "Progression", target: "2 sets of 15" }
        ],
        how: [
          "Kick up into a wall handstand, heels in light contact with the wall, arms straight.",
          "Lower under full control until the crown of your head kisses the floor — touch it as gently as you'd kiss a baby's forehead.",
          "Pause a beat, then press all the way back up. Smooth, even breathing throughout."
        ],
        why: "The full wall handstand pushup: a power-builder for the entire upper body, done against the wall by design — strength first, balance later.",
        easier: "Don't go all the way down at first: the bottom is by far the hardest part. Add depth as you strengthen."
      },
      {
        name: "Close Handstand Pushups",
        standards: [
          { label: "Beginner", target: "1 set of 5" },
          { label: "Intermediate", target: "2 sets of 9" },
          { label: "Progression", target: "2 sets of 12" }
        ],
        how: [
          "Same wall handstand, but with the hands touching — index fingers in contact.",
          "Keeping the elbows out in front, lower until the head gently touches the floor.",
          "Pause under full control, then press back up."
        ],
        why: "The close grip forges the elbow, forearm and wrist tendons that one-arm work will soon demand.",
        easier: "Move the hands an inch closer each week from your normal width — tendons adapt slower than muscles, so don't rush this one."
      },
      {
        name: "Uneven Handstand Pushups",
        perSide: true,
        standards: [
          { label: "Beginner", target: "1 set of 5 (each side)" },
          { label: "Intermediate", target: "2 sets of 8 (each side)" },
          { label: "Progression", target: "2 sets of 10 (each side)" }
        ],
        how: [
          "Kick up into a wall handstand beside a basketball, then carefully place one palm on the ball, hands about shoulder width apart.",
          "The floor arm stays straight; the ball arm is bent. Spread the weight as evenly as you can.",
          "Lower until the head gently touches the floor, then press up. Train both sides."
        ],
        why: "Keeping the ball still while pressing takes enormous arm, shoulder and rotator-cuff strength — gorilla shoulders are made here.",
        easier: "Start with a stable stack (flat bricks, or a pile of books) instead of the ball, and add height gradually until it matches a basketball."
      },
      {
        name: "½ One-Arm Handstand Pushups",
        perSide: true,
        standards: [
          { label: "Beginner", target: "1 set of 4 (each side)" },
          { label: "Intermediate", target: "2 sets of 6 (each side)" },
          { label: "Progression", target: "2 sets of 8 (each side)" }
        ],
        how: [
          "From a wall handstand, shift your weight to one side over several seconds until the other palm carries almost nothing.",
          "Lift that palm off and hold it out for balance — you're now on one straight arm.",
          "Bend the working arm until your head is halfway to the floor, pause, press back up."
        ],
        why: "The first time one arm presses your entire body: strength, balance and courage in equal measure.",
        easier: "Grow the range of motion gradually, and drive the weight through the palm rather than the fingers to line the arm up properly."
      },
      {
        name: "Lever Handstand Pushups",
        perSide: true,
        standards: [
          { label: "Beginner", target: "1 set of 3 (each side)" },
          { label: "Intermediate", target: "2 sets of 4 (each side)" },
          { label: "Progression", target: "2 sets of 6 (each side)" }
        ],
        how: [
          "From a wall handstand, shift about ninety percent of your weight onto one arm.",
          "Flip the other hand palm-up, back of the hand on the floor, and slide it out until that arm is straight in front of you.",
          "Lower under strict control until the skull softly touches the floor, then press back up through both hands."
        ],
        why: "The upturned hand can only help a little — just enough to get you out of the bottom, which is exactly what the final step needs.",
        easier: "Bend the assisting arm to bring it closer to your body for more help, and straighten it out as you get stronger."
      },
      {
        name: "One-Arm Handstand Pushups",
        master: true,
        perSide: true,
        standards: [
          { label: "Beginner", target: "1 set of 1 (each side)" },
          { label: "Intermediate", target: "2 sets of 2 (each side)" },
          { label: "Elite", target: "1 set of 5 (each side)" }
        ],
        how: [
          "Kick up against the wall and shift onto one arm, as in Step 8, body gently arched, heels on the wall.",
          "Lower until the crown of your skull grazes the floor, free hand hovering, ready to catch a mistake.",
          "Press back up — a quick kick of the legs off the wall is allowed to break out of the bottom."
        ],
        why: "The tenth and final step: one of the rarest strength feats in all of calisthenics — years in the making.",
        easier: "Add depth gradually over months. A realistic estimate: around three years of dedicated work. You were going to get three years older anyway."
      }
    ]
  }
];

/* Standard-progress labels used by the tracker (index 0–3). */
const STANDARD_STATES = [
  { key: "working", label: "Working on it", short: "—" },
  { key: "beginner", label: "Beginner standard met", short: "B" },
  { key: "intermediate", label: "Intermediate standard met", short: "I" },
  { key: "progression", label: "Progression standard met", short: "P" }
];
