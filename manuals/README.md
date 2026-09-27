# Manuals

Put PDFs here and import them in one command:

```bash
cd ../backend
python -m app.import_folder ../manuals --manifest ../manuals/manifest.json
```

The PDFs themselves are **not** in the repo (`manuals/*.pdf` is git-ignored): they belong to their
manufacturers, and each person downloads their own copy.

## The ABB manual used in the demo

`manifest.json` expects `acs580_firmware.pdf`: the ACS580 standard control program firmware manual,
462 pages, published by ABB. `library.abb.com` refuses direct downloads, so fetch it from an
authorised distributor's mirror:

```bash
curl -L -o acs580_firmware.pdf \
  "https://cdn.logic-control.com/docs/abb-drives/acs580/ACS580%20Firmware%20Manual.pdf"
```

The manifest reads **PDF pages 381-402**, the fault tracing chapter (printed pages 377-398). That is
where the warning and fault code tables live: 2310 overcurrent, 3210 DC link overvoltage, A2B1,
7081 control panel loss. Ingesting the whole 462-page manual would take hours; the chapter takes
minutes and answers the questions a technician actually asks.

Good questions once it is loaded, on the ACS580 machine:

- "Drive tripped with fault 3210, what do I do?"
- "What does warning A2B1 mean?"
- "The panel shows 7081"
- "Motor is stalling and the drive trips" (no code at all)
