"""Medicine Intelligence & Safety.

Layers, in the order data flows through them:
  repository            trusted reference data (the only source of medical facts)
  identification        OCR text -> a medicine, with an honest confidence level
  prescription_parser   prescription text -> structured instructions
  relevance             medicine <-> the patient's conditions
  prescription_match    medicine <-> the confirmed prescription
  safety                interactions, duplicates, allergies, expiry, missing details
  full_check            combines the above into one summary
  reminders             turns confirmed instructions into schedules
  language_guard        blocks wording that would prescribe or change treatment
  ai                    optional; may only read text from photos or reword verified facts

Everything except `ai` is deterministic and has no network access.
"""
