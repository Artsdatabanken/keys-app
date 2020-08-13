import React from "react";
import Button from "@material-ui/core/Button";
import ReactMarkdown from "react-markdown";
import Typography from "@material-ui/core/Typography";
import Chip from "@material-ui/core/Chip";
import ItemMetadata from "../components/layout/itemMetadata";

// (un)dismisses a taxon or the descendant by taxon id if present in this branch
const toggleDismiss = (taxon, taxonId) => {
  if (taxon.id === taxonId) {
    taxon.dismissed = !taxon.dismissed;
  } else if (taxon.children) {
    taxon.children = taxon.children.map((child) =>
      toggleDismiss(child, taxonId)
    );
  }
  return taxon;
};

// calculates the relevances of a taxon and it's children
const setBranchRelevances = (taxon, alreadyIrrelevant) => {
  // by default, a taxon is relevant if it is not the child of an irrelevant taxon, has not been dismissed and does not have any conflicts
  taxon.isRelevant =
    !alreadyIrrelevant && !taxon.dismissed && !taxon.conflicts.length;
  // by default, irrelevance is the opposite of relevance (but this may change if it has irrelevant children)
  taxon.isIrrelevant = !taxon.isRelevant;

  if (taxon.children) {
    // if it has children, set the (ir)relevances for those
    taxon.children = setTaxonRelevances(taxon.children, taxon.isIrrelevant);

    // a relevant taxon stays relevant only if it has any relevant children
    taxon.isRelevant =
      taxon.isRelevant && taxon.children.some((child) => child.isRelevant);

    // a taxon becomes irrelevant if it is a result with no relevant children (morphs), or not a result with any irrelevant children
    taxon.isIrrelevant =
      taxon.isIrrelevant ||
      (taxon.isResult
        ? !taxon.children.some((child) => child.isRelevant)
        : taxon.children.some((child) => child.isIrrelevant));
  }
  return taxon;
};

// sets the relevances and irrelevances of taxa (as endpoint or parent of an endpoint)
const setTaxonRelevances = (taxa, alreadyIrrelevant = false) => {
  return taxa.map((taxon) => setBranchRelevances(taxon, alreadyIrrelevant));
};

// for a list of taxa, see if there is a statement from a given list (usually for one character) for all relevant taxa
const isRelevantForAllTaxa = (taxa, statements) => {
  // if there are no taxa, the answer is no
  if (taxa === undefined || !taxa.length) {
    return false;
  }

  // only consider taxa that are not excluded
  taxa = taxa.filter((taxon) => !(taxon.dismissed || taxon.conflicts.length));

  for (let taxon of taxa) {
    // if it has a statement or does not have to be considered, everything is okay with this branch
    if (statements.some((s) => s.taxonId === taxon.id) || !taxon.isRelevant) {
      continue;
    }

    // if not, the children (if any) have to be checked
    if (!isRelevantForAllTaxa(taxon.children, statements)) {
      return false;
    }
  }

  // if no taxon returned false, it must be true
  return true;
};

// checks if a taxon id is present in a taxon tree
const isRelevantTaxon = (taxonId, taxa) => {
  if (!taxa) {
    return false;
  }

  for (let taxon of taxa) {
    if (taxon.id === taxonId) {
      return taxon.isRelevant;
    }
    if (isRelevantTaxon(taxonId, taxon.children)) {
      return true;
    }
  }
};

const removeInferrences = (stateObject) => {
  stateObject.characters.forEach((character) => {
    character.alternatives.forEach((alternative) => {
      if (!alternative.isAnswered) {
        stateObject = setFact(stateObject, alternative.id, undefined);
      }
    });
  });
  return stateObject;
};

const setTaxaConflicts = (taxa, alternative, relevantStatements) => {
  return taxa.map((taxon) => {
    if (
      alternative.answerIs !== undefined &&
      !taxon.conflicts.includes(alternative.id) &&
      relevantStatements.some(
        (statement) =>
          statement.taxonId === taxon.id &&
          statement.frequency === +!alternative.answerIs
      )
    ) {
      taxon.conflicts = [...taxon.conflicts, alternative.id];
    } else if (alternative.answerIs === undefined) {
      taxon.conflicts = taxon.conflicts.filter(
        (conflict) => conflict !== alternative.id
      );
    }

    if (taxon.children) {
      taxon.children = setTaxaConflicts(
        taxon.children,
        alternative,
        relevantStatements
      );
    }
    return taxon;
  });
};

const setFact = (stateObject, alternativeId, value) => {
  // give the alternative the new value, remembering the old one
  stateObject.characters = stateObject.characters.map((character) => {
    let isTargetCharacter = false;
    character.alternatives.map((alternative) => {
      if (alternative.id === alternativeId) {
        alternative.answerIs = value;
        isTargetCharacter = true;
      }
      return alternative;
    });

    // mark the character as answered if true and containing any answer, unanswered if it just went from true to undefined
    if (isTargetCharacter) {
      if (
        value &&
        character.alternatives.some((alternative) => alternative.isAnswered)
      ) {
        character.isAnswered = true;
      } else if (
        !character.alternatives.some((alternative) => alternative.answerIs)
      ) {
        character.isAnswered = false;
      }
    }
    return character;
  });

  let relevantAlternative;

  for (let c of stateObject.characters) {
    relevantAlternative = c.alternatives.find((a) => a.id === alternativeId);
    if (relevantAlternative) {
      break;
    }
  }

  let relevantStatements = stateObject.statements.filter(
    (s) => s.value === alternativeId
  );

  // add or remove conflicting *alternatives*
  stateObject.taxa = setTaxaConflicts(
    stateObject.taxa,
    relevantAlternative,
    relevantStatements
  );

  stateObject.taxa = setTaxonRelevances(stateObject.taxa);

  return stateObject;
};

const answer = (stateObject, alternativeId, value) => {
  // mark it as (un)answered
  stateObject.characters.map((character) => {
    character.alternatives.map((alternative) => {
      if (alternative.id === alternativeId) {
        alternative.isAnswered = value !== undefined;
      }
      return alternative;
    });
    return character;
  });

  // set the value of the alternative, the answered state of the character, and add/remove conflicts
  stateObject = setFact(stateObject, alternativeId, value);

  // if removing answer, for every earlier inferrence, undo with setFact
  if (value === undefined) {
    stateObject = removeInferrences(stateObject);
  }

  stateObject = inferAlternatives(stateObject);

  return stateObject;
};

const getAnswer = (alternativeId, characters) => {
  for (let character of characters) {
    let alternative = character.alternatives.find(
      (a) => a.id === alternativeId
    );
    if (alternative) {
      return alternative.answerIs;
    }
    return null;
  }
};

const checkLogicalPremise = (premise, characters) => {
  if (Array.isArray(premise) && premise.length === 1) {
    premise = premise[0];
  }

  if (typeof premise === "string") {
    return getAnswer(premise, characters);
  }

  if (premise.NOT) {
    return !checkLogicalPremise(premise.NOT, characters);
  }

  if (premise.AND) {
    if (premise.AND.length === 1) {
      return checkLogicalPremise(premise.AND, characters);
    } else {
      return (
        checkLogicalPremise(premise.AND[0], characters) &&
        checkLogicalPremise({ AND: premise.AND.slice(1) }, characters)
      );
    }
  }

  if (premise.OR) {
    if (premise.OR.length === 1) {
      return checkLogicalPremise(premise.OR, characters);
    } else {
      return (
        checkLogicalPremise(premise.OR[0], characters) ||
        checkLogicalPremise({ OR: premise.OR.slice(1) }, characters)
      );
    }
  }

  if (premise["<"]) {
    return getAnswer(premise["<"][0], characters) < premise["<"][1];
  }

  if (premise[">"]) {
    return getAnswer(premise[">"][0], characters) > premise[">"][1];
  }

  return undefined;
};

const dismissAllExcept = (taxa, taxaToKeep) => {
  return taxa.map((taxon) => {
    if (taxon.isResult || !taxon.children) {
      if (!taxaToKeep.includes(taxon.scientificName)) {
        taxon.dismissed = true;
      }
    } else if (taxon.children) {
      taxon.children = dismissAllExcept(taxon.children, taxaToKeep);
    }
    return taxon;
  });
};

const containsTaxon = (taxon, scientificNames) => {
  if (taxon.isResult || !taxon.children) {
    return scientificNames.includes(taxon.scientificName);
  } else if (taxon.children) {
    return taxon.children.some((child) =>
      containsTaxon(child, scientificNames)
    );
  }
  return false;
};

const dismissAllExceptCommonTaxon = (taxa, taxaToKeep) => {
  return taxa.map((taxon) => {
    if (!containsTaxon(taxon, taxaToKeep)) {
      taxon.dismissed = true;
    }
    return taxon;
  });
};

const getResultTaxa = (taxon) => {
  if (Array.isArray(taxon)) {
    return taxon
      .map((t) => getResultTaxa(t))
      .filter((t) => t !== null)
      .flat();
  }

  if (taxon.isRelevant) {
    if (taxon.children && !taxon.isResult) {
      return getResultTaxa(taxon.children);
    } else {
      return taxon;
    }
  }

  return null;
};

export const getRelevantTaxaCount = (taxa) => {
  if (Array.isArray(taxa)) {
    return taxa
      .map((t) => getRelevantTaxaCount(t))
      .reduce((acc, tax) => acc + tax);
  }

  if (!taxa.isRelevant) {
    return 0;
  }

  if (taxa.isResult || !taxa.children) {
    return 1;
  }

  return getRelevantTaxaCount(taxa.children);
};

const setResults = (stateObject) => {
  stateObject.results = getResultTaxa(stateObject.taxa);
  return stateObject;
};

// answers a set of alternatives with their values
export const giveAnswers = (stateObject, answers, modalOpener) => {
  answers.forEach((a) => {
    let id, value;
    [id, value] = a;

    stateObject = answer(stateObject, id, value);
  });

  stateObject.relevantTaxaCount = getRelevantTaxaCount(stateObject.taxa);

  // Show the results if there is one taxon left, or no questions left to ask
  if (
    stateObject.relevantTaxaCount === 1 ||
    !stateObject.characters.reduce(
      (count, char) => count + (!char.isAnswered && char.relevant !== false),
      0
    )
  ) {
    stateObject = setResults(stateObject);
    stateObject = setModal(
      stateObject,
      stateObject.results,
      "results",
      modalOpener
    );
  }

  return stateObject;
};

// gives a taxon and all of it's children an empty list of conflicts, standard relevance, and a small and a large media url
export const initElement = (element, mediaElements, persons, organizations) => {
  let small_size = 55;
  let large_size = 1280;

  const getObject = (id, objects) => {
    if (typeof id === "string") {
      id = objects.find((x) => x.id === id);
    } else if (Array.isArray(id)) {
      id = id.map((x) => getObject(x, objects));
    }
    return id;
  };

  // if the element is the entire key
  if (element.statements) {
    ({ mediaElements, persons, organizations } = element);

    element.characters = element.characters.map((x) =>
      initElement(x, mediaElements, persons, organizations)
    );
    element.taxa = element.taxa.map((x) =>
      initElement(x, mediaElements, persons, organizations)
    );

    element.mediaElements = element.mediaElements.map((file) => {
      if (Array.isArray(file.mediaElement)) {
        file.mediaElement = file.mediaElement.map((m) =>
          initElement(m, mediaElements, persons, organizations)
        );
      }
      return file;
    });
  }
  // if the element is a taxon
  else if (element.scientificName || element.vernacularName) {
    element.conflicts = [];
    element.isRelevant = true;
    element.isIrrelevant = false;

    if (element.children) {
      element.children = element.children.map((child) =>
        initElement(child, mediaElements, persons, organizations)
      );
    }
  }

  // if the element is a character
  else if (element.alternatives) {
    small_size = 85;
    element.alternatives = element.alternatives.map((alternative) =>
      initElement(alternative, mediaElements, persons, organizations)
    );
  }

  // if the element is an alternative
  else if (element.content) {
    small_size = 85;
    element.content = element.content.map((alternative) =>
      initElement(alternative, mediaElements, persons, organizations)
    );
  }

  element.creator = getObject(element.creator, persons);
  element.contributor = getObject(element.contributor, persons);
  element.publisher = getObject(element.publisher, organizations);
  element.media = getObject(element.media, mediaElements);
  element.init = true;

  if (element.media) {
    // element.media = initElement(element.media, mediaElements, persons, organizations);

    // get a separate small and large media elements
    if (element.media && Array.isArray(element.media.mediaElement)) {
      element.media_small =
        element.media.mediaElement.find((m) => m.height >= small_size) ||
        element.media.mediaElement[element.media.mediaElement.length - 1];
      element.media_large =
        element.media.mediaElement.find((m) => m.height >= large_size) ||
        element.media.mediaElement[element.media.mediaElement.length - 1];
    } else if (element.media) {
      element.media_small = element.media_large = element.media.mediaElement;
    }
  }

  return element;
};

// sets a taxon as dismissed or not dismissed, whatever is the opposite of the current status
export const toggleTaxonDismissed = (stateObject, taxonId) => {
  stateObject.taxa = stateObject.taxa.map((taxon) =>
    toggleDismiss(taxon, taxonId)
  );

  stateObject.taxa = setTaxonRelevances(stateObject.taxa);
  stateObject = removeInferrences(stateObject);
  stateObject = inferAlternatives(stateObject);
  stateObject.relevantTaxaCount = getRelevantTaxaCount(stateObject.taxa);

  if (stateObject.relevantTaxaCount === 1) {
    stateObject = setResults(stateObject);
    stateObject = setModal(stateObject, stateObject.results, "results");
  }

  return stateObject;
};

// deducts the answers for unanswered alternatives, and marks the character as relevant or irrelevant
export const inferAlternatives = (stateObject) => {
  let relevantStatements = stateObject.statements.filter((sm) =>
    isRelevantTaxon(sm.taxonId, stateObject.taxa)
  );

  // set negatives
  // if a sibling is true, it is negative
  // if all relevant statements are 0, it is negative
  stateObject.characters.forEach((character) => {
    character.alternatives
      .filter(
        (alternative) =>
          alternative.answerIs === undefined &&
          (character.alternatives.some((sibling) => sibling.answerIs) ||
            !relevantStatements.some(
              (sm) => sm.value === alternative.id && sm.frequency !== 0
            ))
      )
      .forEach((alternative) => {
        stateObject = setFact(stateObject, alternative.id, false);
      });
  });

  // set positives
  // if it is the only one remaining, it is positive
  // if all relevant statements are 1, it is positive
  stateObject.characters
    .filter((c) => !c.isAnswered)
    .forEach((character) => {
      character.alternatives
        .filter(
          (alternative) =>
            alternative.answerIs === undefined &&
            (character.alternatives.filter(
              (sibling) => sibling.answerIs === undefined
            ).length === 1 ||
              !relevantStatements.some(
                (sm) => sm.value === alternative.id && sm.frequency !== 1
              ))
        )
        .forEach((alternative) => {
          stateObject = setFact(stateObject, alternative.id, true);
        });
    });

  // set relevance of characters
  // it is irrelevant if it has no answers and either everything is known, or a currently relevant taxon has no statement for it)
  // otherwise it is relevant
  stateObject.characters = stateObject.characters.map((character) => {
    if (
      !character.alternatives.some((alternative) => alternative.isAnswered) &&
      (!character.alternatives.some(
        (alternative) => alternative.answerIs === undefined
      ) ||
        !isRelevantForAllTaxa(
          stateObject.taxa,
          relevantStatements.filter((sm) => sm.characterId === character.id)
        ))
    ) {
      character.relevant = false;
    } else {
      character.relevant =
        !character.logicalPremise ||
        !!checkLogicalPremise(character.logicalPremise, stateObject.characters);
    }
    return character;
  });

  return stateObject;
};

export const isPartOfKey = (taxa, scientificName) => {
  for (let taxon of taxa) {
    if (
      taxon.scientificName === scientificName ||
      (taxon.children && isPartOfKey(taxon.children, scientificName))
    ) {
      return true;
    }
  }
  return false;
};

export const filterTaxaByNames = (stateObject, taxaToKeep, keepCommonTaxon) => {
  if (!keepCommonTaxon) {
    stateObject.taxa = dismissAllExcept(stateObject.taxa, taxaToKeep);
  } else {
    stateObject.taxa = dismissAllExceptCommonTaxon(
      stateObject.taxa,
      taxaToKeep
    );
  }

  stateObject.taxa = setTaxonRelevances(stateObject.taxa);
  stateObject = inferAlternatives(stateObject);

  return stateObject;
};

export const setModal = (stateObject, content, contentType, modalOpener) => {
  let boxStyle = {
    overflow: "auto",
    border: "1px solid #888",
    width: "100vw",
    maxWidth: "100vh",
    height: "80vh",
    marginTop: "10vh",
    marginLeft: "auto",
    marginRight: "auto",
    display: "block",
    backgroundColor: "white",
    borderRadius: "14px",
  };

  if (contentType === "results") {
    if (content.length === 1) {
      contentType = "taxon";

      let {
        vernacularName,
        scientificName,
        media,
        children,
        media_large,
        media_small,
        description,
        descriptionDetails,
        descriptionUrl,
        isResult,
      } = content[0];
      let taxon = {
        vernacularName,
        scientificName,
        media,
        children,
        media_large,
        media_small,
        description,
        descriptionDetails,
        descriptionUrl,
        isResult,
      };

      taxon.children = taxon.children.filter((child) => child.isRelevant);
      content = taxon;
    } else {
      stateObject.modalContent = (
        <div style={boxStyle}>
          <div style={{ margin: "25px" }}>
            <Typography variant="h4" style={{ fontSize: "2em" }} component="h1">
              Resultatet kan ikke bestemmes videre
            </Typography>

            <Typography
              variant="body2"
              style={{ fontSize: "1.25em" }}
              component="p"
            >
              Følgende resultater gjenstår:
            </Typography>

            {content.map((c) => {
              let form;
              if (c.children && c.children.length === 1) {
                form = c.children[0];
              }

              return (
                <div>
                  <hr style={{ marginTop: "3em" }} />
                  <Typography
                    variant="h2"
                    style={{ fontSize: "1.82em" }}
                    component="h2"
                  >
                    {c.vernacularName}
                 
                  </Typography>
                  <Typography
                    variant="body2"
                    component="h3"
                    style={{ marginBottom: "1em", fontSize: "1.2em" }}
                  >
                    <i>{c.scientificName}</i>
                    {form && (
                      <Chip
                        style={{
                          marginLeft: 5
                        }}
                        size="small"
                        variant="default"
                        label={form.vernacularName}
                      />
                    )}
                  </Typography>

                  {c.descriptionUrl && (
                    <div>
                      <Button
                        style={{
                          backgroundColor: "rgb(245, 124, 0)",
                          color: "white",
                        }}
                        onClick={modalOpener.bind(
                          this,
                          c.descriptionUrl,
                          "url"
                        )}
                      >
                        Les mer
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      );
    }
  }

  if (contentType === "url") {
    stateObject.modalContent = (
      <object
        aria-label="External page"
        type="text/html"
        data={content}
        style={boxStyle}
      ></object>
    );
  } else if (contentType === "about") {
    stateObject.modalContent = (
      <div style={boxStyle}>
        <div style={{ margin: "25px" }}>
          <Typography variant="h3" component="h1">
            {stateObject.title}
          </Typography>

          <Typography variant="overline" component="span">
            Bestemmelsesnøkkel{" "}
            {stateObject.creator && "av " + stateObject.creator.name}
            {stateObject.contributor && (
              <span>, {stateObject.contributor.name}</span>
            )}
          </Typography>

          <Typography variant="body1" component="p">
            <b>{stateObject.description}</b>
          </Typography>

          <Typography variant="body2" component="div">
            <ReactMarkdown source={stateObject.descriptionDetails} />
          </Typography>

          <div>
            <Button
              style={{ backgroundColor: "rgb(245, 124, 0)", color: "white" }}
              onClick={modalOpener.bind(
                this,
                stateObject.descriptionUrl,
                "url"
              )}
            >
              Les mer om nøkkelen
            </Button>
          </div>
          <hr style={{ marginTop: "3em" }} />

          <ItemMetadata item={stateObject} modalOpener={modalOpener} />

          <div>Versjon: {stateObject.lastModified}</div>
          <div>Id: {stateObject.identifier}</div>

          <div>Språk: {stateObject.language}</div>
        </div>
      </div>
    );
  } else {
    if (
      contentType === "taxon" &&
      !content.media &&
      content.isResult &&
      content.children.length
    ) {
      let child = content.children.find(c => c.media) || {media: undefined, media_large: undefined};
      content.media = child.media;
      content.media_large = child.media_large;
    }

    let form;
    if (
      contentType === "taxon" &&
      content.children &&
      content.children.length === 1
    ) {
      form = content.children[0];
    }

    stateObject.modalContent = (
      <div style={boxStyle}>
        <div style={{ margin: "25px" }}>
          {content.media_large && (
            <div>
              <img
                src={content.media_large.url}
                style={{
                  maxHeight: "50vh",
                  maxWidth: "90vw",
                  display: "block",
                  marginLeft: "auto",
                  marginRight: "auto",
                }}
                alt={
                  contentType === "taxon"
                    ? `Bilde: ${content.scientificName}`
                    : `Bilde: ${content.title}`
                }
              />
            </div>
          )}
          <Typography variant="h2" style={{ fontSize: "2.5em" }} component="h2">
            {content.vernacularName}
          </Typography>

          <Typography variant="h2" style={{ fontSize: "1.7em" }} component="h2">
            {content.title}
          </Typography>

          <Typography
            variant="body2"
            component="h2"
            style={{ marginBottom: "1em", fontSize: "1.3em" }}
          >
            <i>{content.scientificName}</i>
            {form && (
              <Chip
                style={{ marginLeft: 5}}
                size="small"
                variant="default"
                label={form.vernacularName}
              />
            )}
          </Typography>

          <Typography
            variant="body1"
            component="p"
            style={{ fontSize: "1.4em" }}
          >
            <b>{content.description}</b>
          </Typography>

          <Typography
            variant="body2"
            component="div"
            style={{ marginBottom: "3em", fontSize: "1.2em" }}
          >
            <ReactMarkdown source={content.descriptionDetails} />
          </Typography>
          {content.descriptionUrl && (
            <div>
              <Button
                style={{ backgroundColor: "rgb(245, 124, 0)", color: "white" }}
                onClick={modalOpener.bind(this, content.descriptionUrl, "url")}
              >
                Les mer
              </Button>
            </div>
          )}

          {content.media_large &&
            (content.media_large.creator ||
              content.media_large.publisher ||
              content.media_large.license) && (
              <div>
                <hr style={{ marginTop: "3em" }} />
                <Typography
                  variant="body2"
                  style={{ fontSize: "1.3em" }}
                  component="h2"
                >
                  Bilde:
                </Typography>

                <ItemMetadata
                  item={content.media_large}
                  modalOpener={modalOpener}
                />
              </div>
            )}
        </div>
      </div>
    );
  }

  stateObject.modalOpen = true;
  return stateObject;
};
