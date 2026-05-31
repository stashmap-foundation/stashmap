# Multi-User Usecases

## Decide about locations

Alice, the CEO of "moving village" is scouting locations and wants to get permanent feedback from the shareholders.

She starts with a list:

```
(!) Croatia
    (+) In Europe
        (+) Rechable by Car for most europeans
        (-) Highly regulated
    (+) Very affordable
Panama
Italy
```

Alice wants to learn how the other investors weight each locations, but also wants their input on new locations.
(!) Important is that this is not a forums discussion, the result should always be permanent but living documents, the usage of relevance and argument markers shall allow a common syntax and shall be a help for Alice to understand what the investors want.

## The Enterpreneur

Carol is an enterpreneur, she has a big knowledge graph made of markdowns. It contains ALL emails, documents and all relevant information for her enterprise.
She wants to keep it local, she mainly interacts through an LLM-Agent with the knowledge graph, she does not want to share the graph or parts of it with her employees. But she let's the LLM compile concrete documents for concrete
employees, which contains necessary context for tasks at hand. 

She wants to send these documents to heir employees. She expects her employees to update the documents when new information arises, tasks are done etc. Her LLM should then integrate those updates back into her graph. 

## Kapitaltheorie

Bob is part of a student club, they all read the same excerpts from books about
"Kapitaltheorie". Bob would like to see useful annotatoins of his fellow
students as suggestions (?), so he gets some valuable input. That should not
replace his own studies though. All input from other students should be
non-destructive.

## Opsec

Anon 1, anon 2 and anon 3 run an "Opsec" club. Only users with a membership token can access the club (token management is out of scope for this project).
All the club members can see the content others create and arrange, each of them has different opsec needs so their personal graph looks slightly different,
but they can still access all the content of all the other users.
