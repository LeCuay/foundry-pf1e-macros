/**
 * Allows any user with permission to create new actors to import one from a compendium
 * If that user also has permission to create tokens, will create the specified amount in a stack on top of their current token
 * Gives ownership of the summoned tokens to the summoner
 * 
 * If Turn Alert module is enabled and there is a current combat, will place an alert for when the summons expire
 * 
 * GM users must select a token to act as the summoner
 * Player users must have their character configured under player configuration (linked to their user in the bottom left list of connected/disconnected users)
 * The above can be disabled in config to allow players users to use any owned token as the summoner, but they must select a token
 *
 * Uses standard Pathfinder 1e summon monster/nature's ally rules
 * (1 round/CL, close range, extend metamagic doubles duration, reach metamagic is medium range)
 * 
 **/
const config = {
    packSource: ["pf1",game.world.id], // list of package sources for summons actor folders
    ignoreCompendiums: [""],
    destinationFolder: "Summons", // Folder to file summons in when imported. Will be auto-created by GM users, but not players
    renameAugmented: true, // Appends "(Augmented)" to the token if augmented"
    useUserLinkedActorOnly: true // Change to false to allow users to use any selected token they own as the summoner
};


// Check for Turn Alert module
// const turnAlertActive = game.modules.get("turnAlert")?.active;

// Build options for folders to summon from
let packOptions = `<option value=""></option>` + game.packs.filter(p => p.documentName === "Actor" && config.packSource.includes(p.metadata.packageName) && !config.ignoreCompendiums.includes(p.metadata.name) && p.visible).map(p => `<option value="${p.collection}">${game.i18n.localize(p.title)}</option>`);

let summonerActor;
let summonerToken;
let classArray = [];
let gNumSpawned = 0;
let gNeedSpawn = 100;
let createdMonster;
let range = 0;

// Get actor and token info
if (game.user.isGM || !config.useUserLinkedActorOnly) {
    // GMs must have a token selected
    let selectedTokens = canvas.tokens.controlled;
    if (!selectedTokens.length) ui.notifications.warn("No se ha elegido ningún token como convocador.");
    else {
        summonerToken = selectedTokens[0];
        summonerActor = summonerToken.actor;
    }
}
else {
    // Non GMs must have a character and a token for that character on the map
    summonerActor = game.user.character;
    if (!summonerActor) ui.notifications.warn("No se ha elegido ningún token como convocador.");
    else {
        summonerToken = canvas.tokens.ownedTokens.filter(o => o.actor.id === summonerActor.id)[0];
        if (!summonerToken) ui.notifications.warn(`No hay ningún token disponible de ${summonerActor.name}.`);
    }
}

if (summonerActor && summonerToken) {
    // Build list of character's classes sorted by level (high to low)
    classArray = summonerActor.itemTypes.class.sort((a, b) => {return b.system.level - a.system.level});
    const classOptions = classArray.map((p, index) => `<option value="${index}">${p.name} (${game.i18n.localize("PF1.Level")} ${p.system.level})</option>`);
    
    let ownerCheck = "";
    if (game.user.isGM && summonerActor.hasPlayerOwner) ownerCheck = `<div class="form-group"><label>Dar propiedad a los propietarios de ${summonerActor.name}:</label><input type="checkbox" id="ownerCheck"></div>`;
    
    // Build UI
    const form = `
        <form class="flexcol">
            <div class="form-group">
                <label>Convocador:</label>
                <p>${summonerActor.name}</p>
            </div>
            <div class="form-group">
                <label>NL de la clase:</label>
                <select id="classSelect">${classOptions}</select>
            </div>
            <div class="form-group">
                <label>Sobreescribir NL:</label>
                <input type="number" id="clOverride" placeholder="NL (ej. desde pergaminos)">
            </div>
            <div class="form-group">
                <label>Convocar desde (compendium):</label>
                <select id="sourceSelect">
                    ${packOptions}
                </select>
            </div>
            <div class="form-group">
                <label>Convocación:</label>
                <select id="monsterSelect">
                </select>
            </div>
            <div class="form-group">
                <label>Cantidad a convocar:</label>
                <input type="text" id="summonCount" placeholder="e.g. 1, 1d4+1">
            </div>
            <div class="form-group">
                <label>Convocación aumentada:</label>
                <input type="checkbox" id="augmentCheck">
            </div>
            <div class="form-group">
                <label>Extender (Metamagia):</label>
                <input type="checkbox" id="extendCheck">
            </div>
            <div class="form-group">
                <label>Alcance (Metamagia):</label>
                <input type="checkbox" id="reachCheck">
            </div>
            <div class="form-group">
                <label>${game.i18n.localize("PF1.PACKS.monster-templates")}:</label>
                <label for="celestial" class="radio">
                    Celestial
                    <input name="summoningTemplate" id="celestial" type="radio">
                </label>
                <label for="infernal" class="radio">
                    Infernal
                    <input name="summoningTemplate" id="infernal" type="radio">
                </label>
                <label for="none" class="radio">
                    Ninguna
                    <input name="summoningTemplate" id="none" type="radio" checked>
                </label>
            </div>
            ${ownerCheck}
        </form>
    `;
    
    // Display UI
    const dialog = new Dialog({
      title: "Convocar monstruo",
      content: form,
      buttons: {
        use: {
          icon: '<i class="fas fa-dice-d20"></i>',
          label: "Convocar",
          callback: importMonster
        }
      },
      render: (htm) => {
        htm.find('#sourceSelect').change(populateMonster.bind(this, htm));
      },
    }).render(true);
}

/**
 * On change of source dropdown, populate summon options from the chosen folder
 **/
async function populateMonster(htm, event) {
    // Get the chosen folder
    const selectedPack = event.target.value;
    const monsterSelect = htm.find("#monsterSelect")[0];

    // Populate the options or leave blank if no target chosen
    let monsterOptions = [];
    if (selectedPack) {
        /** @type {CompendiumCollection} */
        let thisPack = game.packs.get(selectedPack);
        if (thisPack.folders.size == 0) {
        let monsterList = await thisPack.getIndex();
        monsterOptions = monsterList.contents
            .sort((a, b) => a.name > b.name ? 1 : -1)
            .map((p) => `<option value="${p._id}">${p.name}</option>`);
        } else {
            /** @type {CompendiumFolderCollection} */
            let folders = thisPack.folders;
            for (let folder of folders) {
                let monsterOptGroup = `<optgroup label="${folder.name}">`;
                monsterOptGroup += folder.contents
                .sort((a, b) => a.name > b.name ? 1 : -1)
                .map((p) => `<option value="${p._id}">${p.name}</option>`)
                .join("");
                // Closing optgroup
                monsterOptGroup += `</optgroup>`;
                monsterOptions.push(monsterOptGroup);
            }

            let monsterList = (await thisPack.getIndex()).contents?.filter((m) => !m.folder);
            if (monsterList.length > 0) {
                let monsterOptGroup = `<optgroup label="Sin categoría">`;
                for (let monsterWithoutFolder of monsterList) {
                    monsterOptGroup += `<option value="${monsterWithoutFolder._id}">${monsterWithoutFolder.name}</option>`;
                }
                // Closing optgroup
                monsterOptGroup += `</optgroup>`;
                monsterOptions.push(monsterOptGroup);
            }
        }
    }

    // Replace options
    monsterSelect.innerHTML = monsterOptions.sort().join("");
}

/**
 * Spawns the token of createdMonster at the position of the mouse when clicked
 */
async function spawnToken() {
    let thisScene = game.scenes.viewed;
    let tokenForId = await createdMonster.getTokenDocument();
    let tokenObject = tokenForId.toObject();
    
    //tokenForId = tokenForId[0].toObject();
    
    let location = canvas.grid.getCenterPoint(getMousePosition());
    
    tokenObject.x = location.x;
    tokenObject.y = location.y;
 
    // Increase this offset for larger summons
    tokenObject.x -= (thisScene.grid.size / 2 + (tokenForId.width - 1) * thisScene.grid.size);
    tokenObject.y -= (thisScene.grid.size / 2 + (tokenForId.height - 1) * thisScene.grid.size);
    
    //tokenObject.actorId = createdMonster.id;
    
    await thisScene.createEmbeddedDocuments("Token", [tokenObject]);
 }

/**
 * Imports the selected monster into the game world, sorts it into the desired folder (if any),
 * spawns the desired number of tokens on top of the summoner's token, creates a chat message giving
 * details about the summon that occured, and creates a Turn Alert alert for when the summon ends (if
 * there is currently combat and Turn Alert is enabled)
 **/
async function importMonster(html) {
    // Get the details of the selected summon
    let selectedPack = html.find("#sourceSelect")[0].value;
    let selectedMonster = html.find("#monsterSelect")[0].value;
    // Get the selected template
    const templates = {
        celestial: "8kHcvgFNoGObDhQ8",
        infernal: "kDaBd3zlTauG2f9n",
    };
    let selectedTemplate = templates[
        html.find("input:radio[name='summoningTemplate']:checked")?.prop("id") || null
    ];
    
    // Gets info about the destination folder, creates it if it does not exist
    let folderID = "";
    
    if (config.destinationFolder) {
        let summonFolder = game.folders.getName(config.destinationFolder);
        if (!summonFolder) {
            let folder = await Folder.create({name: config.destinationFolder, type: "Actor", parent: null});
            folderID = folder.id;
        }
        else {
            folderID = summonFolder.id;
        }
    }
    
    // Import the monster from the compendium
    let monsterEntity = await game.packs.get(selectedPack).getDocument(selectedMonster);
    
    createdMonster = monsterEntity.toObject();
    createdMonster = await Actor.create(createdMonster);

    if (selectedTemplate) {
        const template = await game.packs.get("pf1.monster-templates").getDocument(selectedTemplate);
        const templateData = game.items.fromCompendium(template);
        await createdMonster.createEmbeddedDocuments("Item", [templateData]);
    }
    
    // Update the actor permissions
    let currentPermission = createdMonster.permission;
    let updatedPermission = currentPermission[game.userId] = 3;
    if (game.user.isGM && summonerActor.hasPlayerOwner) {
        let giveOwnerCheck = html.find('#ownerCheck')[0].checked;
        if (giveOwnerCheck) updatedPermission = summonerActor.permission;
    }
    await createdMonster.update({"folder": folderID, "permission": updatedPermission});
    
    
    // Get info about summon count
    let countFormula = html.find("#summonCount").val();
    let roll;
    let rollResult = 0;
    let rollHtml = "";
    
    let testRoll = new Roll(countFormula);
    
    // Verify summon count formula is valid and will result in at least 1 summon
    if (!Roll.validate(countFormula) || (await testRoll.evaluate({minimize: true}).total <= 0)) {
        ui.notifications.error(`${countFormula} no es una fórmula de dados correcta. Usando 1 en su defecto.`);
        countFormula = "1";
    }
    
    // Calculate the roll
    testRoll = new Roll(countFormula);
    roll = await testRoll.roll();
    rollResult = roll.total;
    gNeedSpawn = rollResult;
    
    // Find chosen caster level info
    let chosenIndex = parseInt(html.find("#classSelect").val());
    let classCL = classArray[chosenIndex].system.level;
    let casterLevel = classCL;
    let clOverride = parseInt(html.find("#clOverride").val());
    
    // Validate caster level override is a number > 0
    if (!isNaN(clOverride)) {
        if (clOverride <= 0) ui.notifications.error(`${clOverride} no es un NL válido. Uso de nivel de clase por defecto.`);
        else casterLevel = clOverride;
    }
    
    //Set up buff for augment
    let buffData = null;
    if (html.find("#augmentCheck")[0].checked) {
        buffData = { type: "buff", name: "Convocación aumentada", system: { buffType: "temp" } };
    }
    
    // Set up range as close or medium based on caster level and range metamagic
    if (html.find("#reachCheck")[0].checked) range = (100 + (casterLevel * 10));
    else range = (25 + (Math.floor(casterLevel / 2) * 5));
    
    // Double caster level for extend metamagic
    if (html.find("#extendCheck")[0].checked) casterLevel *= 2;
    
    // Create the buff on the actor for augment, set the bonuses, hide it on the token, and change actor's name
    if (buffData) {
        await createdMonster.createEmbeddedDocuments("Item", [buffData]);
        let buff = createdMonster.items.find(o => o.name === "Convocación aumentada" && o.type === "buff");
        let changes = [];
        changes.push({formula: "4", priority: 1, target: "str", modifier: "enh"});
        changes.push({formula: "4", priority: 1, target: "con", modifier: "enh"});
        await buff.update({"system.changes": changes, "system.hideFromToken": true});
        await buff.update({"system.active": true});
        let actorName = createdMonster.name + " (Aumentado/a)";
        await createdMonster.update({"name": actorName, "token.name": actorName});
    }
    
    
    // Wait for summoner to spawn the rolled number of tokens on the canvas
    ui.notifications.info(`Haz click en el lugar de colocación de ${createdMonster.name} en un rango de ${range} ft desde el convocador (${gNumSpawned} de ${gNeedSpawn})`);
    captureClick();
    
    await sleepWhilePlacing();
    
    stopCapture();
    
    ui.notifications.info("¡Haz terminado de colocar convocaciones!");
    
    // Create chat message about summon
    let msg = `<div class="pf1 chat-card">
                    <header class="card-header flexrow">
                        <h3 class="actor-name">¡Convocación!</h3>
                    </header>
                    <div class="result-text">
                        <p><a class="inline-roll inline-result" title="${roll.formula}" data-roll="${encodeURI(JSON.stringify(roll))}"><i class="fas fa-dice-d20"></i> ${roll.total}</a> ${createdMonster.name} convocado durante ${casterLevel} ronda/s en un rango de ${range} pies.</p>
                    </div>
                </div>`
                
    ChatMessage.create({
        content: msg
    });
}

/**
 * The following functions were provided by the Foundry community.
 * 
 * Captures mouse clicks, determines the square to spawn monster in through mouse position at time of click, and spawns the token at that location.
 */
function getMousePosition() {
  return canvas.mousePosition;
}

function getCenterGrid(point = {})
{
  const arr = canvas.grid.getCenter(point.x, point.y);
  return { x: arr[0], y : arr[1] };
}

async function handleClick(event) {
    if(gNumSpawned < gNeedSpawn && !!createdMonster){
        await spawnToken();
        gNumSpawned++;
        ui.notifications.info(`Haz click en el lugar de colocación de ${createdMonster.name} en un rango de ${range} ft desde el convocador (${gNumSpawned} de ${gNeedSpawn})`);
    }
}
 
function captureClick() {
  $(document.body).on("click", handleClick);
}
 
function stopCapture() {
   $(document.body).off("click", handleClick); 
}
 
const wait = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
 
async function sleepWhilePlacing() {
    while(gNumSpawned<gNeedSpawn){
        await wait(100);
    }
}
